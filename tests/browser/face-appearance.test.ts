import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import type * as THREE from "three"
import type { DogAppearance } from "../../src/dog"
import type {
  FaceAppearance,
  FaceAppearanceManifest,
} from "../../src/faceAppearance"

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/smal-pets-parity.json", import.meta.url),
    "utf8",
  ),
) as {
  count: number
  vertexCount: number
  faceCount: number
  restPositions: number[]
  faces: number[]
  faceIds: number[]
  weights: number[]
  positions: number[]
  quaternions: number[]
  scales: number[]
  cases: { name: string; posedPositions: number[] }[]
}
const base = "/models/synthetic-smal/"

function binary(values: number[], type: "f32" | "u32" | "u16" = "f32"): Buffer {
  const width = type === "u16" ? 2 : 4
  const result = Buffer.alloc(values.length * width)
  for (let index = 0; index < values.length; index++) {
    if (type === "f32") result.writeFloatLE(values[index], index * width)
    else if (type === "u32") result.writeUInt32LE(values[index], index * width)
    else result.writeUInt16LE(values[index], index * width)
  }
  return result
}

const faces = binary(fixture.faces, "u32")
const manifest: FaceAppearanceManifest = {
  version: 1,
  kind: "smal-pets-faces",
  count: fixture.count,
  vertexCount: fixture.vertexCount,
  faceCount: fixture.faceCount,
  nearestFaces: 10,
  coordinateSpace: "mesh-local-y-up",
  topologyHash: createHash("sha256").update(faces).digest("hex"),
  files: {
    splats: "dog.ply",
    restPositions: "rest.f32",
    faces: "faces.u32",
    faceIds: "ids.u16",
    weights: "weights.f32",
  },
  clips: ["idle", "walk", "spin"].map((name) => ({
    name,
    duration: 3,
    times: "times.f32",
    positions: `${name}.f32`,
  })),
  mouth: { face: 0, barycentric: [0.2, 0.3, 0.5] },
  gaitCadence: {
    walk: { cyclesPerSecond: 1, travelSpeed: 2 },
    run: { cyclesPerSecond: 2, travelSpeed: 4 },
  },
}

function ply(): Buffer {
  const properties = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ]
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${fixture.count}`,
    ...properties.map((name) => `property float ${name}`),
    "end_header",
  ]
  const rows = Array.from({ length: fixture.count }, (_, index) => [
    ...fixture.positions.slice(index * 3, index * 3 + 3),
    1,
    -0.5,
    -1,
    8,
    ...fixture.scales.slice(index * 3, index * 3 + 3).map(Math.log),
    fixture.quaternions[index * 4 + 3],
    ...fixture.quaternions.slice(index * 4, index * 4 + 3),
  ])
  return Buffer.concat([
    Buffer.from([...header, ""].join("\n")),
    binary(rows.flat()),
  ])
}

async function installFixture(page: Page): Promise<void> {
  const articulated = fixture.cases.find((pose) => pose.name === "articulated")
  const rigid = fixture.cases.find((pose) => pose.name === "rigid")
  if (!articulated || !rigid) throw new Error("Missing synthetic pose")
  const files: Record<string, Buffer | string> = {
    "manifest.json": JSON.stringify(manifest),
    "bad-manifest.json": JSON.stringify({
      ...manifest,
      topologyHash: "0".repeat(64),
    }),
    "rest.f32": binary(fixture.restPositions),
    "faces.u32": faces,
    "ids.u16": binary(fixture.faceIds, "u16"),
    "weights.f32": binary(fixture.weights),
    "times.f32": binary([0, 3]),
    "idle.f32": binary([...fixture.restPositions, ...fixture.restPositions]),
    "walk.f32": binary([
      ...fixture.restPositions,
      ...articulated.posedPositions,
    ]),
    "spin.f32": binary([...fixture.restPositions, ...rigid.posedPositions]),
    "dog.ply": ply(),
  }
  await page.route(`**${base}*`, async (route) => {
    const name = new URL(route.request().url()).pathname
      .split("/")
      .at(-1) as string
    const body = files[name]
    await route.fulfill({
      status: body === undefined ? 404 : 200,
      contentType: name.endsWith("json")
        ? "application/json"
        : "application/octet-stream",
      body: body ?? "Missing fixture",
    })
  })
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      path: "work/test-rig.glb",
      contentType: "model/gltf-binary",
    }),
  )
  await page.route("**/models/synthetic-rig.glb", (route) =>
    route.fulfill({
      path: "work/test-rig.glb",
      contentType: "model/gltf-binary",
    }),
  )
}

test.beforeEach(async ({ page }) => {
  await installFixture(page)
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
})

test("evaluates the actual GPU face modifier for identity, rigid, scaling, articulated, and collapsed faces", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const results = await page.evaluate(
    async ({ manifestUrl, poses }) => {
      const appearancePath = "/src/faceAppearance.ts"
      const deformationPath = "/src/faceDeformation.ts"
      const readbackPath = "/tests/browser/face-readback.ts"
      const { loadFaceAppearance } = (await import(
        appearancePath
      )) as typeof import("../../src/faceAppearance")
      const { FaceDeformation, deformFaceGaussian } = (await import(
        deformationPath
      )) as typeof import("../../src/faceDeformation")
      const { readFaceGaussians } = (await import(
        readbackPath
      )) as typeof import("./face-readback")
      const renderer = (
        window.dogSandbox as typeof window.dogSandbox & {
          renderer: THREE.WebGLRenderer
        }
      ).renderer
      const manifestResponse = await fetch(manifestUrl)
      const metadata = await manifestResponse.json()
      const ids = new Uint16Array(
        await (
          await fetch(
            new URL(
              metadata.files.faceIds,
              manifestResponse.url || new URL(manifestUrl, location.href),
            ).href,
          )
        ).arrayBuffer(),
      )
      const weights = new Float32Array(
        await (
          await fetch(
            new URL(metadata.files.weights, new URL(manifestUrl, location.href))
              .href,
          )
        ).arrayBuffer(),
      )
      const faces = new Uint32Array(
        await (
          await fetch(
            new URL(metadata.files.faces, new URL(manifestUrl, location.href))
              .href,
          )
        ).arrayBuffer(),
      )
      const result: { name: string; maximumError: number; finite: boolean }[] =
        []
      for (const density of [100000, 17]) {
        const appearance = await loadFaceAppearance(manifestUrl, density)
        appearance.checkTextureSize(renderer)
        const source = appearance.splats.extSplats
        if (!source) throw new Error("Missing loaded Gaussian source")
        const frame = new FaceDeformation(
          appearance.vertexPositions.slice(),
          faces,
        )
        try {
          for (const pose of poses) {
            const positions = new Float32Array(pose.posedPositions)
            frame.updatePositions(positions)
            appearance.updatePositions(positions)
            const actual = await readFaceGaussians(appearance, renderer)
            const expected: number[] = []
            for (let index = 0; index < source.numSplats; index++) {
              const splat = source.getSplat(index)
              const posed = deformFaceGaussian(
                frame.data,
                ids,
                weights,
                splat.center,
                splat.quaternion,
                splat.scales,
                index * 10,
              )
              expected.push(
                ...posed.position.toArray(),
                ...posed.quaternion.toArray(),
                ...posed.scales.toArray(),
              )
            }
            result.push({
              name: `${pose.name} at density ${source.numSplats}`,
              maximumError: Math.max(
                ...actual.map((value, index) =>
                  Math.abs(value - expected[index]),
                ),
              ),
              finite: actual.every(Number.isFinite),
            })
          }
        } finally {
          appearance.dispose()
        }
      }
      return result
    },
    { manifestUrl: `${base}manifest.json`, poses: fixture.cases },
  )
  for (const pose of results) {
    expect(pose.finite, pose.name).toBe(true)
    expect(pose.maximumError, pose.name).toBeLessThan(5e-5)
  }
  expect(errors).toEqual([])
})

test("retains baked poses through transitions, pause, density changes, and an atomic failed import", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const loaded = await page.evaluate(async (manifestUrl) => {
    const load = window.dogSandbox.loadDog as (
      url: string,
      name?: string,
      appearance?: DogAppearance,
    ) => Promise<boolean>
    return load("/models/synthetic-rig.glb", "Synthetic face-bound dog", {
      kind: "smal-pets-faces",
      manifestUrl,
    })
  }, `${base}manifest.json`)
  expect(loaded).toBe(true)
  await expect(page.locator("#splat-count")).toHaveText("64")
  const state = await page.evaluate(async (badManifestUrl) => {
    const dog = window.dogSandbox.dog
    const internal = dog as unknown as { faceAppearance: FaceAppearance }
    const appearance = internal.faceAppearance
    dog.paused = false
    dog.playAction("walk")
    for (let index = 0; index < 4; index++) dog.update(0.1)
    dog.paused = true
    const walking = appearance.vertexPositions.slice()
    dog.playAction("spin")
    dog.update(0)
    const transitionStartError = Math.max(
      ...walking.map((value, index) =>
        Math.abs(value - appearance.vertexPositions[index]),
      ),
    )
    dog.paused = false
    const target = appearance.sample("spin", 0.1).slice()
    dog.update(0.1)
    dog.paused = true
    const blend = (1 / 3) ** 2 * (3 - 2 / 3)
    const transitionError = Math.max(
      ...walking.map((value, index) =>
        Math.abs(
          value * (1 - blend) +
            target[index] * blend -
            appearance.vertexPositions[index],
        ),
      ),
    )
    const paused = appearance.vertexPositions.slice()
    dog.update(1)
    const pauseError = Math.max(
      ...paused.map((value, index) =>
        Math.abs(value - appearance.vertexPositions[index]),
      ),
    )
    await dog.rebuildSplats(16)
    const densityError = Math.max(
      ...paused.map((value, index) =>
        Math.abs(value - internal.faceAppearance.vertexPositions[index]),
      ),
    )
    const limitedCount = dog.sampleCount
    await dog.rebuildSplats(100000)
    const maxCount = dog.sampleCount
    const previous = internal.faceAppearance
    const load = window.dogSandbox.loadDog as (
      url: string,
      name?: string,
      appearance?: DogAppearance,
    ) => Promise<boolean>
    const failed = await load("/models/synthetic-rig.glb", "Broken face dog", {
      kind: "smal-pets-faces",
      manifestUrl: badManifestUrl,
    })
    const retained =
      internal.faceAppearance === previous && dog.sampleCount === maxCount
    dog.playAction("walk")
    dog.paused = false
    dog.update(0.1)
    dog.paused = true
    return {
      transitionStartError,
      transitionError,
      pauseError,
      densityError,
      limitedCount,
      maxCount,
      failed,
      retained,
      action: dog.action,
      faceMode: dog.hasFaceAppearance,
    }
  }, `${base}bad-manifest.json`)
  expect(state.transitionStartError).toBeLessThan(1e-7)
  expect(state.transitionError).toBeLessThan(1e-6)
  expect(state.pauseError).toBeLessThan(1e-7)
  expect(state.densityError).toBeLessThan(1e-7)
  expect(state.limitedCount).toBe(16)
  expect(state.maxCount).toBe(64)
  expect(state.failed).toBe(false)
  expect(state.retained).toBe(true)
  expect(state.action).toBe("walk")
  expect(state.faceMode).toBe(true)
  await expect(page.locator("#notice")).toHaveText(
    "Face appearance topology hash does not match",
  )
  const original = await page.evaluate(async () => {
    const load = window.dogSandbox.loadDog as (
      url: string,
      name?: string,
      appearance?: DogAppearance,
    ) => Promise<boolean>
    const success = await load("/models/dog-animated.glb", "Original dog")
    return {
      success,
      faceMode: window.dogSandbox.dog.hasFaceAppearance,
      count: window.dogSandbox.dog.sampleCount,
    }
  })
  expect(original.success).toBe(true)
  expect(original.faceMode).toBe(false)
  expect(original.count).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
