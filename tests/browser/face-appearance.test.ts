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
  cases: {
    name: string
    posedPositions: number[]
    positions: number[]
    quaternions: number[]
    scales: number[]
  }[]
}
const base = "/models/synthetic-smal/"
const clockRig = readFileSync("work/test-rig.glb")
const clockDocument = JSON.parse(
  clockRig.subarray(20, 20 + clockRig.readUInt32LE(12)).toString(),
) as {
  animations: { name: string; samplers: { input: number }[] }[]
  accessors: { max: number[] }[]
}
const clockDurations = Object.fromEntries(
  clockDocument.animations.map((clip) => [
    clip.name,
    Math.fround(
      Math.max(
        ...clip.samplers.map(
          (sampler) => clockDocument.accessors[sampler.input].max[0],
        ),
      ),
    ),
  ]),
)

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
  clips: ["idle", "walk", "spin", "sniff", "sit"].map((name) => ({
    name,
    duration: clockDurations[name] ?? clockDurations.idle,
    times: `${name}-times.f32`,
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

function rigWithBakedClocks(): Buffer {
  const source = readFileSync("work/test-rig.glb")
  const jsonLength = source.readUInt32LE(12)
  const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString()) as {
    animations: { name: string }[]
  }
  const idle = gltf.animations.find((clip) => clip.name === "idle")
  if (!idle) throw new Error("Synthetic rig has no idle clock")
  for (const name of ["sniff", "sit"]) gltf.animations.push({ ...idle, name })
  const json = Buffer.from(JSON.stringify(gltf))
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
  ])
  const tail = source.subarray(20 + jsonLength)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded, tail])
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
    "bad-duration-manifest.json": JSON.stringify({
      ...manifest,
      clips: manifest.clips.map((clip) =>
        clip.name === "walk"
          ? {
              ...clip,
              duration: clip.duration + 0.25,
              times: "bad-walk-times.f32",
            }
          : clip,
      ),
    }),
    "bad-walk-times.f32": binary([0, clockDurations.walk + 0.25]),
    "rounded-duration-manifest.json": JSON.stringify({
      ...manifest,
      clips: manifest.clips.map((clip) =>
        clip.name === "walk"
          ? {
              ...clip,
              duration: Math.fround(clip.duration + 1e-6),
              times: "rounded-walk-times.f32",
            }
          : clip,
      ),
    }),
    "rounded-walk-times.f32": binary([
      0,
      Math.fround(clockDurations.walk + 1e-6),
    ]),
    "precise-manifest.json": JSON.stringify({
      ...manifest,
      files: { ...manifest.files, restTransforms: "rest-transforms.f32" },
    }),
    "rest-transforms.f32": binary(
      Array.from({ length: fixture.count }, (_, index) => [
        ...fixture.quaternions.slice(index * 4, index * 4 + 4),
        ...fixture.scales.slice(index * 3, index * 3 + 3),
        0,
      ]).flat(),
    ),
    "rest.f32": binary(fixture.restPositions),
    "faces.u32": faces,
    "ids.u16": binary(fixture.faceIds, "u16"),
    "weights.f32": binary(fixture.weights),
    ...Object.fromEntries(
      manifest.clips.map((clip) => [clip.times, binary([0, clip.duration])]),
    ),
    "idle.f32": binary([...fixture.restPositions, ...fixture.restPositions]),
    "walk.f32": binary([
      ...fixture.restPositions,
      ...articulated.posedPositions,
    ]),
    "spin.f32": binary([...fixture.restPositions, ...rigid.posedPositions]),
    "sit.f32": binary([...fixture.restPositions, ...rigid.posedPositions]),
    "sniff.f32": binary(
      Array.from({ length: 2 }, () =>
        fixture.restPositions.map(
          (value, index) => value + [0.35, 0.12, -0.7][index % 3],
        ),
      ).flat(),
    ),
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
      body: rigWithBakedClocks(),
      contentType: "model/gltf-binary",
    }),
  )
}

async function loadSyntheticDog(page: Page): Promise<void> {
  const loaded = await page.evaluate((manifestUrl) => {
    return window.dogSandbox.loadDog(
      "/models/synthetic-rig.glb",
      "Synthetic face-bound dog",
      { kind: "smal-pets-faces", manifestUrl },
    )
  }, `${base}manifest.json`)
  expect(loaded).toBe(true)
  await page.evaluate(() => {
    window.dogSandbox.dog.paused = true
  })
}

async function delayNextManifest(page: Page, fail = false) {
  let release = () => {}
  let requested = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = new Promise<void>((resolve) => {
    requested = resolve
  })
  let count = 0
  await page.route(`**${base}manifest.json`, async (route) => {
    if (count++ === 0) {
      requested()
      await gate
      if (fail) {
        await route.fulfill({ status: 503, body: "Fixture unavailable" })
        return
      }
    }
    await route.fallback()
  })
  return { requested: request, release }
}

type FaceLifecycleWindow = Window & {
  faceLifecycle: {
    pending: Promise<{ ok: boolean; error?: string }>
    disposals: number[]
  }
}

async function startObservedRebuild(page: Page, count: number): Promise<void> {
  await page.evaluate((density) => {
    const dog = window.dogSandbox.dog
    const current = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    const prototype = Object.getPrototypeOf(current) as FaceAppearance
    const disposals: number[] = []
    const dispose = prototype.dispose
    prototype.dispose = function () {
      disposals.push(this.splats.numSplats)
      dispose.call(this)
    }
    const pending = dog.rebuildSplats(density).then(
      () => ({ ok: true }),
      (error: Error) => ({ ok: false, error: error.message }),
    )
    Object.assign(window, { faceLifecycle: { pending, disposals } })
  }, count)
}

test.beforeEach(async ({ page }) => {
  await installFixture(page)
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
})

test("places a lateral baked jaw over the ball before grabbing after a smooth approach", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const pickup = await page.evaluate(() => {
    const { dog, renderer, fetchPlay } =
      window.dogSandbox as typeof window.dogSandbox & {
        renderer: THREE.WebGLRenderer
        fetchPlay: import("../../src/fetch").FetchInteraction
      }
    renderer.setAnimationLoop(null)
    dog.paused = false
    dog.group.rotation.y = 2.6
    const appearance = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    const displayed = appearance.vertexPositions.slice()
    const target = fetchPlay.ball.position.clone().set(-1.4, 0, -1.6)
    const offset = dog.sampleActionMouthOffset("sniff", 0.85, target.clone())
    if (!offset) throw new Error("Missing baked mouth sample")
    const samplePreservedPose = displayed.every(
      (value, index) => value === appearance.vertexPositions[index],
    )
    const sampledAction = dog.action
    fetchPlay.throwTo(target)
    const heading = Math.atan2(-target.x, -target.z)
    const expected = target.clone().sub(
      offset
        .clone()
        .setY(0)
        .applyAxisAngle(fetchPlay.ball.position.clone().set(0, 1, 0), heading),
    )
    let maximumYawStep = 0
    let previousYaw = dog.group.rotation.y
    let settlingFrames = 0
    for (
      let frame = 0;
      frame < 1500 && fetchPlay.state !== "picking-up";
      frame++
    ) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
      fetchPlay.updateBallPosition()
      maximumYawStep = Math.max(
        maximumYawStep,
        Math.abs(
          Math.atan2(
            Math.sin(dog.group.rotation.y - previousYaw),
            Math.cos(dog.group.rotation.y - previousYaw),
          ),
        ),
      )
      previousYaw = dog.group.rotation.y
      if (
        fetchPlay.state === "chasing" &&
        Math.hypot(
          dog.group.position.x - expected.x,
          dog.group.position.z - expected.z,
        ) < 0.001
      )
        settlingFrames++
    }
    for (let frame = 0; frame < 49; frame++) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
      fetchPlay.updateBallPosition()
    }
    dog.paused = true
    const mouth = dog.getMouthWorldPosition(target.clone())
    return {
      samplePreservedPose,
      sampledAction,
      state: fetchPlay.state,
      action: dog.action,
      offset: offset.toArray(),
      maximumYawStep,
      settlingFrames,
      headingError: Math.abs(
        Math.atan2(
          Math.sin(heading - dog.group.rotation.y),
          Math.cos(heading - dog.group.rotation.y),
        ),
      ),
      stopError: Math.hypot(
        dog.group.position.x - expected.x,
        dog.group.position.z - expected.z,
      ),
      mouthHorizontalGap: Math.hypot(
        mouth.x - fetchPlay.ball.position.x,
        mouth.z - fetchPlay.ball.position.z,
      ),
      ballHeight: fetchPlay.ball.position.y,
    }
  })
  expect(pickup.samplePreservedPose).toBe(true)
  expect(pickup.sampledAction).toBe("idle")
  expect(pickup.state).toBe("picking-up")
  expect(pickup.action).toBe("sniff")
  expect(Math.abs(pickup.offset[0])).toBeGreaterThan(0.1)
  expect(pickup.maximumYawStep).toBeLessThanOrEqual(3.8 / 60 + 1e-10)
  expect(pickup.settlingFrames).toBeGreaterThan(0)
  expect(pickup.headingError).toBeLessThan(0.006)
  expect(pickup.stopError).toBeLessThan(1e-7)
  expect(pickup.mouthHorizontalGap).toBeLessThan(0.01)
  expect(pickup.ballHeight).toBeCloseTo(0.12)
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

test("preserves full-precision rest transforms through every pose and density prefix", async ({
  page,
}) => {
  const measured = await page.evaluate(
    async ({ manifestUrl, fixture }) => {
      const appearancePath = "/src/faceAppearance.ts"
      const readbackPath = "/tests/browser/face-readback.ts"
      const { loadFaceAppearance } = (await import(
        appearancePath
      )) as typeof import("../../src/faceAppearance")
      const { readFaceGaussians } = (await import(
        readbackPath
      )) as typeof import("./face-readback")
      const renderer = (
        window.dogSandbox as typeof window.dogSandbox & {
          renderer: THREE.WebGLRenderer
        }
      ).renderer
      renderer.setAnimationLoop(null)
      const result = []
      let decodedRotationError = 0
      for (const density of [fixture.count, 17]) {
        const appearance = await loadFaceAppearance(manifestUrl, density)
        const source = appearance.splats.extSplats
        if (!source) throw new Error("Missing Gaussian source")
        try {
          for (let index = 0; index < source.numSplats; index++) {
            const quaternion = source.getSplat(index).quaternion.toArray()
            const expected = fixture.quaternions.slice(index * 4, index * 4 + 4)
            decodedRotationError = Math.max(
              decodedRotationError,
              Math.min(
                ...[1, -1].map((sign) =>
                  Math.max(
                    ...quaternion.map((value, axis) =>
                      Math.abs(value - sign * expected[axis]),
                    ),
                  ),
                ),
              ),
            )
          }
          for (const pose of fixture.cases) {
            appearance.updatePositions(new Float32Array(pose.posedPositions))
            const actual = await readFaceGaussians(appearance, renderer)
            let positionError = 0
            let rotationError = 0
            let scaleError = 0
            for (let index = 0; index < source.numSplats; index++) {
              const offset = index * 10
              for (let axis = 0; axis < 3; axis++) {
                positionError = Math.max(
                  positionError,
                  Math.abs(
                    actual[offset + axis] - pose.positions[index * 3 + axis],
                  ),
                )
                scaleError = Math.max(
                  scaleError,
                  Math.abs(
                    actual[offset + 7 + axis] - pose.scales[index * 3 + axis],
                  ),
                )
              }
              rotationError = Math.max(
                rotationError,
                Math.min(
                  ...[1, -1].map((sign) =>
                    Math.max(
                      ...actual
                        .slice(offset + 3, offset + 7)
                        .map((value, axis) =>
                          Math.abs(
                            value - sign * pose.quaternions[index * 4 + axis],
                          ),
                        ),
                    ),
                  ),
                ),
              )
            }
            result.push({
              name: `${pose.name} at ${source.numSplats}`,
              finite: actual.every(Number.isFinite),
              positionError,
              rotationError,
              scaleError,
            })
          }
        } finally {
          appearance.dispose()
        }
      }
      return { decodedRotationError, poses: result }
    },
    { manifestUrl: `${base}precise-manifest.json`, fixture },
  )
  expect(measured.decodedRotationError).toBeGreaterThan(5e-4)
  for (const pose of measured.poses) {
    expect(pose.finite, pose.name).toBe(true)
    expect(pose.positionError, pose.name).toBeLessThan(5e-5)
    expect(pose.rotationError, pose.name).toBeLessThan(5e-5)
    expect(pose.scaleError, pose.name).toBeLessThan(5e-5)
  }
})

test("keeps baked vertices synchronized with speed, loop wraps, paused density changes, and a held Sit", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  await page.evaluate(() => {
    const { dog, renderer } = window.dogSandbox as typeof window.dogSandbox & {
      renderer: THREE.WebGLRenderer
    }
    renderer.setAnimationLoop(null)
    dog.paused = false
  })
  await page.locator("#speed").fill("1.5")
  await expect(page.locator("#speed-value")).toHaveText("1.5×")
  await page.getByRole("button", { name: "Walk", exact: true }).click()
  const looped = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const internal = dog as unknown as {
      active: THREE.AnimationAction
      faceAppearance: FaceAppearance
    }
    const errorAt = (time: number) => {
      const expected = internal.faceAppearance.sample("walk", time)
      return Math.max(
        ...expected.map((value, index) =>
          Math.abs(value - internal.faceAppearance.vertexPositions[index]),
        ),
      )
    }
    for (let frame = 0; frame < 4; frame++) dog.update(0.1)
    const speedPhase = internal.active.time
    const speedError = errorAt(0.6)
    dog.setActionRate(0.5)
    for (let frame = 0; frame < 44; frame++) dog.update(0.1)
    const duration = internal.active.getClip().duration
    const expectedPhase = (0.6 + 44 * 0.1 * 1.5 * 0.5) % duration
    return {
      speed: dog.speed,
      speedPhase,
      speedError,
      actionRate: dog.actionRate,
      wrappedPhase: internal.active.time,
      duration,
      expectedPhase,
      wrappedError: errorAt(expectedPhase),
      action: dog.action,
    }
  })
  expect(looped.speed).toBe(1.5)
  expect(looped.speedPhase).toBeCloseTo(0.6, 7)
  expect(looped.speedError).toBeLessThan(2e-6)
  expect(looped.actionRate).toBe(0.5)
  expect(looped.wrappedPhase).toBeCloseTo(looped.expectedPhase, 7)
  expect(looped.wrappedError).toBeLessThan(2e-6)
  expect(looped.action).toBe("walk")
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  const frozen = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const internal = dog as unknown as {
      active: THREE.AnimationAction
      faceAppearance: FaceAppearance
    }
    const before = internal.faceAppearance.vertexPositions.slice()
    const time = internal.active.time
    for (let frame = 0; frame < 20; frame++) dog.update(0.1)
    return {
      poseUnchanged: before.every(
        (value, index) =>
          value === internal.faceAppearance.vertexPositions[index],
      ),
      clockUnchanged: internal.active.time === time,
      vertices: Array.from(before),
    }
  })
  expect(frozen.poseUnchanged).toBe(true)
  expect(frozen.clockUnchanged).toBe(true)
  await page.locator("#speed").fill("0.5")
  await page.locator("#density").evaluate((input) => {
    const slider = input as HTMLInputElement
    slider.value = "16"
    slider.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(page.locator("#splat-count")).toHaveText("16")
  const retained = await page.evaluate((vertices) => {
    const dog = window.dogSandbox.dog
    const internal = dog as unknown as {
      active: THREE.AnimationAction
      faceAppearance: FaceAppearance
    }
    return {
      paused: dog.paused,
      time: internal.active.time,
      error: Math.max(
        ...vertices.map((value, index) =>
          Math.abs(value - internal.faceAppearance.vertexPositions[index]),
        ),
      ),
    }
  }, frozen.vertices)
  expect(retained.paused).toBe(true)
  expect(retained.time).toBeCloseTo(looped.expectedPhase, 7)
  expect(retained.error).toBeLessThan(1e-7)
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  const expectedResumePhase = (looped.expectedPhase + 0.025) % looped.duration
  const resumed = await page.evaluate((expectedPhase) => {
    const dog = window.dogSandbox.dog
    dog.update(0.1)
    const internal = dog as unknown as {
      active: THREE.AnimationAction
      faceAppearance: FaceAppearance
    }
    const expected = internal.faceAppearance.sample("walk", expectedPhase)
    return {
      time: internal.active.time,
      error: Math.max(
        ...expected.map((value, index) =>
          Math.abs(value - internal.faceAppearance.vertexPositions[index]),
        ),
      ),
    }
  }, expectedResumePhase)
  expect(resumed.time).toBeCloseTo(expectedResumePhase, 7)
  expect(resumed.error).toBeLessThan(2e-6)
  await page.getByRole("button", { name: "Sit", exact: true }).click()
  const held = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const internal = dog as unknown as {
      active: THREE.AnimationAction
      faceAppearance: FaceAppearance
    }
    for (let frame = 0; frame < 80; frame++) dog.update(0.1)
    const duration = internal.active.getClip().duration
    const endpoint = internal.faceAppearance.sample("sit", duration)
    const endpointError = Math.max(
      ...endpoint.map((value, index) =>
        Math.abs(value - internal.faceAppearance.vertexPositions[index]),
      ),
    )
    const displayed = internal.faceAppearance.vertexPositions.slice()
    for (let frame = 0; frame < 20; frame++) dog.update(0.1)
    return {
      action: dog.action,
      time: internal.active.time,
      duration,
      clamped: internal.active.paused,
      endpointError,
      heldUnchanged: displayed.every(
        (value, index) =>
          value === internal.faceAppearance.vertexPositions[index],
      ),
    }
  })
  expect(held.action).toBe("sit")
  expect(held.time).toBe(held.duration)
  expect(held.clamped).toBe(true)
  expect(held.endpointError).toBeLessThan(2e-6)
  expect(held.heldUnchanged).toBe(true)
})

test("retains the previous dog when GLB and baked animation durations disagree", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const result = await page.evaluate(async (manifestUrl) => {
    const { dog, renderer } = window.dogSandbox as typeof window.dogSandbox & {
      renderer: THREE.WebGLRenderer
    }
    renderer.setAnimationLoop(null)
    const internal = dog as unknown as {
      root: THREE.Group
      faceAppearance: FaceAppearance
    }
    const previousRoot = internal.root
    const previousAppearance = internal.faceAppearance
    const previousPositions = previousAppearance.vertexPositions.slice()
    const count = dog.sampleCount
    const loaded = await window.dogSandbox.loadDog(
      "/models/synthetic-rig.glb",
      "Incompatible clock dog",
      { kind: "smal-pets-faces", manifestUrl },
    )
    dog.paused = false
    dog.playAction("walk")
    for (let frame = 0; frame < 4; frame++) dog.update(0.1)
    dog.paused = true
    return {
      loaded,
      retainedRoot: internal.root === previousRoot,
      retainedAppearance: internal.faceAppearance === previousAppearance,
      attached: previousAppearance.mesh.parent !== null,
      countUnchanged: count === dog.sampleCount,
      action: dog.action,
      poseMoved: internal.faceAppearance.vertexPositions.some(
        (value, index) => value !== previousPositions[index],
      ),
    }
  }, `${base}bad-duration-manifest.json`)
  expect(result.loaded).toBe(false)
  expect(result.retainedRoot).toBe(true)
  expect(result.retainedAppearance).toBe(true)
  expect(result.attached).toBe(true)
  expect(result.countUnchanged).toBe(true)
  expect(result.action).toBe("walk")
  expect(result.poseMoved).toBe(true)
  await expect(page.locator("#asset-name")).toHaveText(
    "Synthetic face-bound dog",
  )
  await expect(page.locator("#notice")).toHaveText(
    "Baked animation duration does not match GLB clip: walk",
  )
})

test("accepts Float32 clock rounding and ordinary GLB imports", async ({
  page,
}) => {
  const rounded = await page.evaluate(async (manifestUrl) => {
    const loaded = await window.dogSandbox.loadDog(
      "/models/synthetic-rig.glb",
      "Rounded baked clock dog",
      { kind: "smal-pets-faces", manifestUrl },
    )
    return {
      loaded,
      hasFaceAppearance: window.dogSandbox.dog.hasFaceAppearance,
    }
  }, `${base}rounded-duration-manifest.json`)
  expect(rounded.loaded).toBe(true)
  expect(rounded.hasFaceAppearance).toBe(true)
  const imported = await page.evaluate(async () => {
    const loaded = await window.dogSandbox.loadDog(
      "/models/synthetic-rig.glb",
      "Ordinary rigged dog",
    )
    return {
      loaded,
      hasFaceAppearance: window.dogSandbox.dog.hasFaceAppearance,
    }
  })
  expect(imported.loaded).toBe(true)
  expect(imported.hasFaceAppearance).toBe(false)
  await expect(page.locator("#asset-name")).toHaveText("Ordinary rigged dog")
})

test("keeps the latest density and current pose when an older request finishes last", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const delayed = await delayNextManifest(page)
  await startObservedRebuild(page, 16)
  await delayed.requested
  const latest = await page.evaluate(async () => {
    const dog = window.dogSandbox.dog
    dog.playAction("walk")
    dog.paused = false
    for (let frame = 0; frame < 5; frame++) dog.update(0.1)
    dog.paused = true
    const before = (
      dog as unknown as { faceAppearance: FaceAppearance }
    ).faceAppearance.vertexPositions.slice()
    await dog.rebuildSplats(32)
    const appearance = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    return {
      count: dog.sampleCount,
      poseError: Math.max(
        ...before.map((value, index) =>
          Math.abs(value - appearance.vertexPositions[index]),
        ),
      ),
    }
  })
  expect(latest.count).toBe(32)
  expect(latest.poseError).toBeLessThan(1e-7)
  delayed.release()
  const completed = await page.evaluate(async () => {
    const lifecycle = (window as unknown as FaceLifecycleWindow).faceLifecycle
    const outcome = await lifecycle.pending
    const dog = window.dogSandbox.dog
    return {
      outcome,
      count: dog.sampleCount,
      density: dog.density,
      action: dog.action,
      disposals: lifecycle.disposals,
    }
  })
  expect(completed.outcome.ok).toBe(true)
  expect(completed.count).toBe(32)
  expect(completed.density).toBe(32)
  expect(completed.action).toBe("walk")
  expect(completed.disposals).toEqual([64, 16])
})

test("discards a delayed density candidate after switching back to the original model", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const delayed = await delayNextManifest(page)
  await startObservedRebuild(page, 16)
  await delayed.requested
  const switched = await page.evaluate(async () => {
    const success = await window.dogSandbox.loadDog(
      "/models/dog-animated.glb",
      "Original dog",
    )
    window.dogSandbox.dog.paused = true
    return { success, count: window.dogSandbox.dog.sampleCount }
  })
  expect(switched.success).toBe(true)
  delayed.release()
  const completed = await page.evaluate(async () => {
    const lifecycle = (window as unknown as FaceLifecycleWindow).faceLifecycle
    return {
      outcome: await lifecycle.pending,
      count: window.dogSandbox.dog.sampleCount,
      faceMode: window.dogSandbox.dog.hasFaceAppearance,
      disposals: lifecycle.disposals,
    }
  })
  expect(completed.outcome.ok).toBe(true)
  expect(completed.count).toBe(switched.count)
  expect(completed.faceMode).toBe(false)
  expect(completed.disposals).toEqual([64, 16])
})

test("disposes a delayed density candidate when the dog is removed", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const delayed = await delayNextManifest(page)
  await startObservedRebuild(page, 16)
  await delayed.requested
  await page.evaluate(() => {
    window.dogSandbox.dog.dispose()
  })
  delayed.release()
  const completed = await page.evaluate(async () => {
    const lifecycle = (window as unknown as FaceLifecycleWindow).faceLifecycle
    const outcome = await lifecycle.pending
    const dog = window.dogSandbox.dog
    return {
      outcome,
      count: dog.sampleCount,
      faceMode: dog.hasFaceAppearance,
      children: dog.group.children.length,
      attached: dog.group.parent !== null,
      disposals: lifecycle.disposals,
    }
  })
  expect(completed.outcome.ok).toBe(true)
  expect(completed.count).toBe(0)
  expect(completed.faceMode).toBe(false)
  expect(completed.children).toBe(0)
  expect(completed.attached).toBe(false)
  expect(completed.disposals).toEqual([64, 16])
})

test("restores the density control and previous face appearance after a network failure", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const delayed = await delayNextManifest(page, true)
  await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    dog.playAction("walk")
    dog.paused = false
    dog.update(0.1)
    dog.paused = true
    Object.assign(window, {
      previousFaceAppearance: (
        dog as unknown as { faceAppearance: FaceAppearance }
      ).faceAppearance,
    })
  })
  await page.locator("#density").evaluate((input) => {
    const slider = input as HTMLInputElement
    slider.value = "16"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await delayed.requested
  await expect(page.locator("#density")).toBeDisabled()
  delayed.release()
  await expect(page.locator("#density")).toBeEnabled()
  await expect(page.locator("#density")).toHaveValue("64")
  await expect(page.locator("#density-value")).toHaveText("64")
  await expect(page.locator("#splat-count")).toHaveText("64")
  await expect(page.locator("#notice")).toBeVisible()
  const retained = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const previous = (
      window as Window & { previousFaceAppearance?: FaceAppearance }
    ).previousFaceAppearance
    const current = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    return {
      retained: current === previous,
      density: dog.density,
      count: dog.sampleCount,
      action: dog.action,
      paused: dog.paused,
    }
  })
  expect(retained).toEqual({
    retained: true,
    density: 64,
    count: 64,
    action: "walk",
    paused: true,
  })
})

test("disposes an unsupported density candidate and preserves the loaded appearance", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const result = await page.evaluate(async () => {
    const { dog, renderer } = window.dogSandbox as typeof window.dogSandbox & {
      renderer: THREE.WebGLRenderer
    }
    renderer.setAnimationLoop(null)
    const current = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    const prototype = Object.getPrototypeOf(current) as FaceAppearance
    const dispose = prototype.dispose
    const disposals: number[] = []
    prototype.dispose = function () {
      disposals.push(this.splats.numSplats)
      dispose.call(this)
    }
    const maximumSize = renderer.capabilities.maxTextureSize
    renderer.capabilities.maxTextureSize = 1
    let message = ""
    try {
      await dog.rebuildSplats(16)
    } catch (error) {
      message = (error as Error).message
    } finally {
      renderer.capabilities.maxTextureSize = maximumSize
    }
    return {
      message,
      retained:
        (dog as unknown as { faceAppearance: FaceAppearance })
          .faceAppearance === current,
      attached: current.mesh.parent !== null,
      count: dog.sampleCount,
      density: dog.density,
      disposals,
    }
  })
  expect(result.message).toBe("Face binding exceeds this device's texture size")
  expect(result.retained).toBe(true)
  expect(result.attached).toBe(true)
  expect(result.count).toBe(64)
  expect(result.density).toBe(64)
  expect(result.disposals).toEqual([16])
})

test("syncs the carried ball to the baked mouth after each animation frame", async ({
  page,
}) => {
  await loadSyntheticDog(page)
  const carried = await page.evaluate(() => {
    const { dog, renderer, fetchPlay } =
      window.dogSandbox as typeof window.dogSandbox & {
        renderer: THREE.WebGLRenderer
        fetchPlay: import("../../src/fetch").FetchInteraction
      }
    renderer.setAnimationLoop(null)
    fetchPlay.throwTo(dog.group.position.clone().set(-1.2, 0, -1.4))
    let frames = 0
    let maximumGap = 0
    let unsynchronizedGap = 0
    const mouth = fetchPlay.ball.position.clone()
    for (let frame = 0; frame < 600; frame++) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
      if (fetchPlay.state === "returning") {
        frames++
        unsynchronizedGap = Math.max(
          unsynchronizedGap,
          dog.getMouthWorldPosition(mouth).distanceTo(fetchPlay.ball.position),
        )
        fetchPlay.updateBallPosition()
        maximumGap = Math.max(
          maximumGap,
          dog.getMouthWorldPosition(mouth).distanceTo(fetchPlay.ball.position),
        )
      }
      if (frames > 20) break
    }
    return { frames, maximumGap, unsynchronizedGap }
  })
  expect(carried.frames).toBeGreaterThan(20)
  expect(carried.unsynchronizedGap).toBeGreaterThan(1e-4)
  expect(carried.maximumGap).toBeLessThan(1e-7)
})
