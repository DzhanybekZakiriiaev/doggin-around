import { createHash } from "node:crypto"
import { ExtSplats } from "@sparkjsdev/spark"
import * as THREE from "three"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FaceAppearance,
  type FaceAppearanceManifest,
  loadFaceAppearance,
  parseFaceManifest,
  readFaceFloats,
  validateBakedClip,
  validateFaceBinding,
} from "../../src/faceAppearance"

function manifest(): FaceAppearanceManifest {
  return {
    version: 1,
    kind: "smal-pets-faces",
    count: 1,
    vertexCount: 3,
    faceCount: 1,
    nearestFaces: 10,
    coordinateSpace: "mesh-local-y-up",
    topologyHash: "0".repeat(64),
    files: {
      splats: "dog.ply",
      restPositions: "rest.f32",
      faces: "faces.u32",
      faceIds: "ids.u16",
      weights: "weights.f32",
    },
    clips: [
      {
        name: "idle",
        duration: 1,
        times: "idle-times.f32",
        positions: "idle-positions.f32",
      },
    ],
    mouth: { face: 0, barycentric: [0.2, 0.3, 0.5] },
    gaitCadence: {
      walk: { cyclesPerSecond: 1, travelSpeed: 2 },
      run: { cyclesPerSecond: 2, travelSpeed: 4 },
    },
  }
}

function floats(values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * 4)
  const view = new DataView(buffer)
  for (let index = 0; index < values.length; index++)
    view.setFloat32(index * 4, values[index], true)
  return buffer
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("face appearance asset validation", () => {
  it("accepts the explicit mesh-local coordinate contract", () => {
    const value = manifest()
    expect(parseFaceManifest(value)).toBe(value)
  })

  it("rejects incompatible coordinate spaces and binding widths", () => {
    expect(() =>
      parseFaceManifest({ ...manifest(), coordinateSpace: "world" }),
    ).toThrow("manifest")
    expect(() => parseFaceManifest({ ...manifest(), nearestFaces: 4 })).toThrow(
      "manifest",
    )
    expect(() =>
      parseFaceManifest({ ...manifest(), faceCount: 65537 }),
    ).toThrow("manifest")
  })

  it("rejects missing clips, duplicate clips, and invalid mouth landmarks", () => {
    const value = manifest()
    expect(() => parseFaceManifest({ ...value, clips: [] })).toThrow("clips")
    expect(() =>
      parseFaceManifest({ ...value, clips: [...value.clips, ...value.clips] }),
    ).toThrow("clip")
    expect(() =>
      parseFaceManifest({
        ...value,
        mouth: { face: 0, barycentric: [0.5, 0.5, 0.5] },
      }),
    ).toThrow("mouth")
    expect(() =>
      parseFaceManifest({
        ...value,
        mouth: { face: 1, barycentric: [1, 0, 0] },
      }),
    ).toThrow("mouth")
  })

  it("decodes little-endian float files and rejects bad sizes and non-finite values", () => {
    expect(Array.from(readFaceFloats(floats([1.25, -2.5, 8]), 3))).toEqual([
      1.25, -2.5, 8,
    ])
    expect(() => readFaceFloats(new ArrayBuffer(3))).toThrow("size")
    expect(() => readFaceFloats(floats([1]), 2)).toThrow("size")
    expect(() => readFaceFloats(floats([Number.NaN]))).toThrow("Non-finite")
  })

  it("requires ten valid face ids and normalized nonnegative weights per PLY row", () => {
    const ids = new Uint16Array(10)
    const weights = new Float32Array(10).fill(0.1)
    expect(() => validateFaceBinding(ids, weights, 1)).not.toThrow()
    expect(() => validateFaceBinding(ids.subarray(1), weights, 1)).toThrow(
      "size",
    )
    const invalidIds = ids.slice()
    invalidIds[3] = 1
    expect(() => validateFaceBinding(invalidIds, weights, 1)).toThrow("binding")
    const invalidWeights = weights.slice()
    invalidWeights[2] = -0.1
    expect(() => validateFaceBinding(ids, invalidWeights, 1)).toThrow("binding")
    expect(() =>
      validateFaceBinding(ids, new Float32Array(10).fill(0.2), 1),
    ).toThrow("normalized")
  })

  it("checks timestamp order, duration, and complete vertex samples", () => {
    const clip = {
      name: "idle",
      duration: 1,
      times: new Float32Array([0, 1]),
      positions: new Float32Array(18),
    }
    expect(() => validateBakedClip(clip, 3)).not.toThrow()
    expect(() =>
      validateBakedClip({ ...clip, times: new Float32Array([0, 0, 1]) }, 3),
    ).toThrow("timestamps")
    expect(() =>
      validateBakedClip({ ...clip, times: new Float32Array([0, 2]) }, 3),
    ).toThrow("timestamps")
    expect(() =>
      validateBakedClip({ ...clip, positions: new Float32Array(9) }, 3),
    ).toThrow("positions")
  })

  it("resolves every binary path relative to the manifest and rejects topology drift before loading a PLY", async () => {
    vi.stubGlobal("window", { location: { href: "https://demo.test/studio/" } })
    const value = manifest()
    const faceBytes = new ArrayBuffer(12)
    const view = new DataView(faceBytes)
    for (let corner = 0; corner < 3; corner++)
      view.setUint32(corner * 4, corner, true)
    const files: Record<string, ArrayBuffer> = {
      "rest.f32": floats([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      "faces.u32": faceBytes,
      "ids.u16": new ArrayBuffer(20),
      "weights.f32": floats(Array(10).fill(0.1)),
      "idle-times.f32": floats([0, 1]),
      "idle-positions.f32": new ArrayBuffer(72),
    }
    const requested: string[] = []
    vi.stubGlobal("fetch", async (url: string | URL) => {
      requested.push(url.toString())
      const file = url.toString().split("/").at(-1) as string
      return {
        ok: true,
        json: async () => value,
        arrayBuffer: async () => files[file],
      }
    })
    await expect(
      loadFaceAppearance("../models/smal/manifest.json", 100),
    ).rejects.toThrow("topology hash")
    expect(requested).toHaveLength(7)
    expect(
      requested.every((url) =>
        url.startsWith("https://demo.test/models/smal/"),
      ),
    ).toBe(true)
    expect(requested.some((url) => url.endsWith("dog.ply"))).toBe(false)
  })
})

describe("face appearance lifecycle", () => {
  it("disposes a partially loaded Gaussian source when the PLY row count mismatches metadata", async () => {
    vi.stubGlobal("window", { location: { href: "https://demo.test/" } })
    const value = manifest()
    const faceBytes = new ArrayBuffer(12)
    const view = new DataView(faceBytes)
    for (let corner = 0; corner < 3; corner++)
      view.setUint32(corner * 4, corner, true)
    value.topologyHash = createHash("sha256")
      .update(new Uint8Array(faceBytes))
      .digest("hex")
    const files: Record<string, ArrayBuffer> = {
      "rest.f32": floats([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      "faces.u32": faceBytes,
      "ids.u16": new ArrayBuffer(20),
      "weights.f32": floats(Array(10).fill(0.1)),
      "idle-times.f32": floats([0, 1]),
      "idle-positions.f32": new ArrayBuffer(72),
    }
    vi.stubGlobal("fetch", async (url: string | URL) => ({
      ok: true,
      json: async () => value,
      arrayBuffer: async () =>
        files[url.toString().split("/").at(-1) as string],
    }))
    vi.spyOn(ExtSplats.prototype, "asyncInitialize").mockImplementation(
      async function (this: ExtSplats) {
        for (let index = 0; index < 2; index++)
          this.pushSplat(
            new THREE.Vector3(),
            new THREE.Vector3(0.1, 0.1, 0.1),
            new THREE.Quaternion(),
            1,
            new THREE.Color("white"),
          )
      },
    )
    const dispose = vi.spyOn(ExtSplats.prototype, "dispose")
    await expect(loadFaceAppearance("/manifest.json", 1)).rejects.toThrow(
      "wrong Gaussian count",
    )
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("samples without applying, applies one full mesh deformation, and disposes once", async () => {
    const rest = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const end = rest.map((value, index) => value + (index % 3 === 1 ? 2 : 0))
    const source = new ExtSplats()
    source.pushSplat(
      new THREE.Vector3(0, 0, 0.1),
      new THREE.Vector3(0.02, 0.02, 0.02),
      new THREE.Quaternion(),
      1,
      new THREE.Color("white"),
    )
    const disposeSource = vi.spyOn(source, "dispose")
    const appearance = new FaceAppearance(
      manifest(),
      source,
      rest,
      new Uint32Array([0, 1, 2]),
      new Uint16Array(10),
      new Float32Array(10).fill(0.1),
      [
        {
          name: "idle",
          duration: 1,
          times: new Float32Array([0, 1]),
          positions: new Float32Array([...rest, ...end]),
        },
      ],
      "https://demo.test/manifest.json",
    )
    await appearance.splats.initialized
    expect(appearance.mesh).toBeInstanceOf(THREE.Mesh)
    expect(appearance.mesh).not.toBeInstanceOf(THREE.SkinnedMesh)
    expect(appearance.splats.skinning).toBeNull()
    const sample = appearance.sample("idle", 0.5)
    expect(sample).not.toBe(appearance.vertexPositions)
    expect(appearance.vertexPositions).toEqual(rest)
    appearance.updatePositions(sample)
    expect(appearance.vertexPositions[1]).toBe(1)
    const positionAttribute = appearance.mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute
    const version = positionAttribute.version
    appearance.updatePositions(sample)
    expect(positionAttribute.version).toBe(version)
    appearance.mesh.position.set(1, 2, 3)
    expect(
      appearance
        .getMouthPosition(new THREE.Vector3())
        .distanceTo(new THREE.Vector3(1.3, 3.5, 3)),
    ).toBeLessThan(1e-7)
    expect(appearance.maxDensity).toBe(1)
    expect(appearance.manifestUrl).toBe("https://demo.test/manifest.json")
    const disposeMesh = vi.spyOn(appearance.mesh.geometry, "dispose")
    appearance.dispose()
    appearance.dispose()
    expect(disposeSource).toHaveBeenCalledTimes(1)
    expect(disposeMesh).toHaveBeenCalledTimes(1)
  })
})
