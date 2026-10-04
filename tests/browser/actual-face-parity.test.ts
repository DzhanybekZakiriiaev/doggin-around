import { execFileSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import type * as THREE from "three"
import type { FaceAppearance } from "../../src/faceAppearance"

const manifestPath = "public/models/tricolor-research/manifest.json"
const manifestUrl = "/models/tricolor-research/manifest.json"

test.skip(
  !existsSync(manifestPath),
  "The final licensed research export is available only in the local demo",
)

const referenceScript = `
import hashlib, json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path.cwd() / 'scripts/smal_pets'))
from gaussians import read_ply
from geometry import body_forward, deform
path = Path(sys.argv[1])
manifest = json.loads(path.read_text())
base = path.parent
rest = np.fromfile(base / manifest['files']['restPositions'], dtype='<f4').reshape(-1, 3)
faces_bytes = (base / manifest['files']['faces']).read_bytes()
faces = np.frombuffer(faces_bytes, dtype='<u4').reshape(-1, 3)
assert hashlib.sha256(faces_bytes).hexdigest() == manifest['topologyHash']
ids = np.fromfile(base / manifest['files']['faceIds'], dtype='<u2').reshape(-1, 10)
weights = np.fromfile(base / manifest['files']['weights'], dtype='<f4').reshape(-1, 10)
cloud_path = base / manifest['files']['splats']
cloud = read_ply(cloud_path)
count = len(cloud['means'])
assert count == manifest['count']
transforms = np.fromfile(base / manifest['files']['restTransforms'], dtype='<f4').reshape(-1, 8)
assert len(transforms) == count
normalized_quaternions = cloud['quats'] / np.linalg.norm(cloud['quats'], axis=1, keepdims=True)
assert np.allclose(transforms[:, :4], normalized_quaternions[:, [1, 2, 3, 0]], atol=2e-7)
assert np.allclose(transforms[:, 4:7], np.exp(cloud['log_scales']), atol=2e-7)
rows = np.unique(np.round(np.linspace(0, count - 1, min(count, 256))).astype(int))
clips = {clip['name']: clip for clip in manifest['clips']}
poses = []
for name, fraction in [('rest', 0), ('walk', .25), ('run', .35), ('sit', 1), ('sniff', .4), ('bark', .45)]:
    time = 0
    posed = rest
    if name != 'rest':
        clip = clips[name]
        time = clip['duration'] * fraction
        times = np.fromfile(base / clip['times'], dtype='<f4').astype(np.float64)
        positions = np.fromfile(base / clip['positions'], dtype='<f4').reshape(len(times), -1, 3)
        right = min(max(np.searchsorted(times, time, side='right'), 1), len(times) - 1)
        alpha = np.clip((time - times[right - 1]) / (times[right] - times[right - 1]), 0, 1)
        posed = ((1 - alpha) * positions[right - 1].astype(np.float64) + alpha * positions[right].astype(np.float64)).astype(np.float32)
    p, q, s = deform(cloud['means'][rows], cloud['quats'][rows], np.exp(cloud['log_scales'][rows]), rest, posed, faces, ids[rows], weights[rows])
    poses.append({'name': name, 'time': time, 'posedPositions': posed.reshape(-1).tolist(), 'positions': p.reshape(-1).tolist(), 'quaternions': q[:, [1, 2, 3, 0]].reshape(-1).tolist(), 'scales': s.reshape(-1).tolist()})
body_heading = body_forward(rest)
nose_heading = rest[1863] - rest[452]
nose_heading[1] = 0
assert np.linalg.norm(nose_heading) > 1e-8
nose_heading /= np.linalg.norm(nose_heading)
print(json.dumps({'count': count, 'vertexCount': len(rest), 'faceCount': len(faces), 'topologyHash': manifest['topologyHash'], 'plySha256': hashlib.sha256(cloud_path.read_bytes()).hexdigest(), 'rows': rows.tolist(), 'bodyForward': body_heading.tolist(), 'noseForward': nose_heading.tolist(), 'poses': poses}))
`

type RealReference = {
  count: number
  vertexCount: number
  faceCount: number
  topologyHash: string
  plySha256: string
  rows: number[]
  bodyForward: number[]
  noseForward: number[]
  poses: {
    name: string
    time: number
    posedPositions: number[]
    positions: number[]
    quaternions: number[]
    scales: number[]
  }[]
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("tricolor")
  await expect(page.locator("#asset-name")).toHaveText("Tricolor dog", {
    timeout: 60000,
  })
  await expect(page.locator("#notice")).toBeHidden()
})

test("the actual export matches NumPy positions, rotations, and scales for articulated clips", async ({
  page,
}) => {
  test.setTimeout(120000)
  const reference = JSON.parse(
    execFileSync(
      process.env.SMAL_PYTHON ?? "python3",
      ["-c", referenceScript, manifestPath],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ),
  ) as RealReference
  expect(reference.vertexCount).toBe(3889)
  expect(reference.bodyForward.every(Number.isFinite)).toBe(true)
  expect(reference.bodyForward[2]).toBeLessThan(-0.99)
  expect(Math.abs(reference.bodyForward[0])).toBeLessThan(0.02)
  expect(reference.noseForward.every(Number.isFinite)).toBe(true)
  expect(reference.noseForward[2]).toBeLessThan(-0.25)
  const measurements = await page.evaluate(
    async ({ reference, manifestUrl }) => {
      const sandbox = window.dogSandbox as typeof window.dogSandbox & {
        renderer: THREE.WebGLRenderer
      }
      sandbox.renderer.setAnimationLoop(null)
      const loaded = await sandbox.loadDog(
        "/models/tricolor-research/dog-animated.glb",
        "Tricolor dog",
        { kind: "smal-pets-faces", manifestUrl, density: reference.count },
      )
      if (!loaded) throw new Error("Could not load the actual export")
      sandbox.dog.paused = true
      const appearance = (
        sandbox.dog as unknown as { faceAppearance: FaceAppearance }
      ).faceAppearance
      const readerPath = "/tests/browser/face-readback.ts"
      const { readFaceGaussians } = (await import(
        readerPath
      )) as typeof import("./face-readback")
      const result = []
      for (const pose of reference.poses) {
        const vertices =
          pose.name === "rest"
            ? new Float32Array(pose.posedPositions)
            : appearance.sample(pose.name, pose.time)
        let maximumVertexError = 0
        for (let index = 0; index < vertices.length; index++)
          maximumVertexError = Math.max(
            maximumVertexError,
            Math.abs(vertices[index] - pose.posedPositions[index]),
          )
        appearance.updatePositions(vertices)
        const actual = await readFaceGaussians(appearance, sandbox.renderer)
        let maximumPositionError = 0
        let maximumRotationError = 0
        let maximumScaleError = 0
        let maximumQuaternionNormError = 0
        let finite = true
        for (let sample = 0; sample < reference.rows.length; sample++) {
          const offset = reference.rows[sample] * 10
          for (let component = 0; component < 10; component++)
            finite = finite && Number.isFinite(actual[offset + component])
          for (let axis = 0; axis < 3; axis++) {
            maximumPositionError = Math.max(
              maximumPositionError,
              Math.abs(
                actual[offset + axis] - pose.positions[sample * 3 + axis],
              ),
            )
            maximumScaleError = Math.max(
              maximumScaleError,
              Math.abs(
                actual[offset + 7 + axis] - pose.scales[sample * 3 + axis],
              ),
            )
          }
          let positiveError = 0
          let negativeError = 0
          let normSquared = 0
          for (let axis = 0; axis < 4; axis++) {
            const value = actual[offset + 3 + axis]
            const expected = pose.quaternions[sample * 4 + axis]
            positiveError = Math.max(positiveError, Math.abs(value - expected))
            negativeError = Math.max(negativeError, Math.abs(value + expected))
            normSquared += value * value
          }
          maximumRotationError = Math.max(
            maximumRotationError,
            Math.min(positiveError, negativeError),
          )
          maximumQuaternionNormError = Math.max(
            maximumQuaternionNormError,
            Math.abs(Math.sqrt(normSquared) - 1),
          )
        }
        result.push({
          name: pose.name,
          time: pose.time,
          finite,
          maximumVertexError,
          maximumPositionError,
          maximumRotationError,
          maximumScaleError,
          maximumQuaternionNormError,
        })
      }
      return result
    },
    { reference, manifestUrl },
  )
  writeFileSync(
    "work/tricolor/actual-face-parity.json",
    `${JSON.stringify({ count: reference.count, sampledRows: reference.rows.length, vertexCount: reference.vertexCount, faceCount: reference.faceCount, topologyHash: reference.topologyHash, plySha256: reference.plySha256, bodyForward: reference.bodyForward, noseForward: reference.noseForward, measurements }, null, 2)}\n`,
  )
  for (const pose of measurements) {
    expect(pose.finite, pose.name).toBe(true)
    expect(pose.maximumVertexError, pose.name).toBeLessThan(2e-6)
    expect(pose.maximumPositionError, pose.name).toBeLessThan(5e-5)
    expect(pose.maximumRotationError, pose.name).toBeLessThan(5e-5)
    expect(pose.maximumScaleError, pose.name).toBeLessThan(5e-5)
    expect(pose.maximumQuaternionNormError, pose.name).toBeLessThan(1e-6)
  }
})

test("the actual mouth landmark follows the lower jaw during pickup and carrying", async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.getByRole("button", { name: "Toss the ball" }).click()
  await expect(page.locator("#fetch-status")).toHaveText("PICKING IT UP", {
    timeout: 30000,
  })
  await page.waitForTimeout(500)
  const pickup = await page.evaluate(() => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    dog.paused = true
    const mouth = dog.getMouthWorldPosition(fetchPlay.ball.position.clone())
    return {
      state: fetchPlay.state,
      mouth: mouth.toArray(),
      ball: fetchPlay.ball.position.toArray(),
      gap: mouth.distanceTo(fetchPlay.ball.position),
    }
  })
  await page.screenshot({ path: "work/tricolor/actual-fetch-pickup.png" })
  writeFileSync(
    "work/tricolor/actual-pickup-check.json",
    `${JSON.stringify(pickup, null, 2)}\n`,
  )
  expect(pickup.state).toBe("picking-up")
  expect(pickup.gap).toBeLessThan(0.25)
  expect(pickup.mouth[1]).toBeLessThan(0.35)
  await page.evaluate(() => {
    window.dogSandbox.dog.paused = false
  })
  await expect(page.locator("#fetch-status")).toHaveText("BRINGING IT BACK", {
    timeout: 15000,
  })
  const mouth = await page.evaluate(() => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    dog.paused = true
    const appearance = (dog as unknown as { faceAppearance: FaceAppearance })
      .faceAppearance
    const point = fetchPlay.ball.position.clone()
    const mouth = dog.getMouthWorldPosition(point).clone()
    const jaw = point
      .fromArray(appearance.vertexPositions, 910 * 3)
      .applyMatrix4(appearance.mesh.matrixWorld)
      .clone()
    const nose = point
      .fromArray(appearance.vertexPositions, 1863 * 3)
      .applyMatrix4(appearance.mesh.matrixWorld)
    return {
      state: fetchPlay.state,
      mouth: mouth.toArray(),
      ball: fetchPlay.ball.position.toArray(),
      jawDistance: mouth.distanceTo(jaw),
      noseDistance: mouth.distanceTo(nose),
      ballGap: mouth.distanceTo(fetchPlay.ball.position),
      landmark: appearance.manifest.mouth,
    }
  })
  await page.screenshot({ path: "work/tricolor/actual-fetch-carrying.png" })
  writeFileSync(
    "work/tricolor/actual-mouth-check.json",
    `${JSON.stringify(mouth, null, 2)}\n`,
  )
  expect(mouth.state).toBe("returning")
  expect(mouth.jawDistance).toBeLessThan(0.025)
  expect(mouth.jawDistance).toBeLessThan(mouth.noseDistance)
  expect(mouth.ballGap).toBeLessThan(1e-5)
})

test("the actual mesh keeps every action above the floor", async ({ page }) => {
  test.setTimeout(120000)
  const clips = await page.evaluate(() => {
    const appearance = (
      window.dogSandbox.dog as unknown as { faceAppearance: FaceAppearance }
    ).faceAppearance
    return appearance.manifest.clips.map(({ name, duration }) => ({
      name,
      duration,
    }))
  })
  const measurements = []
  for (const { name, duration } of clips) {
    await page.locator(`[data-action="${name}"]`).click()
    const result = await page.evaluate(
      async ({ name, duration }) => {
        const dog = window.dogSandbox.dog
        const appearance = (
          dog as unknown as { faceAppearance: FaceAppearance }
        ).faceAppearance
        dog.paused = false
        dog.setView("mesh")
        let minimumY = Infinity
        let worstTime = 0
        const started = performance.now()
        await new Promise<void>((resolve) => {
          const observe = (now: number) => {
            const matrix = appearance.mesh.matrixWorld.elements
            const positions = appearance.vertexPositions
            let frameMinimum = Infinity
            for (let index = 0; index < positions.length; index += 3)
              frameMinimum = Math.min(
                frameMinimum,
                matrix[1] * positions[index] +
                  matrix[5] * positions[index + 1] +
                  matrix[9] * positions[index + 2] +
                  matrix[13],
              )
            if (frameMinimum < minimumY) {
              minimumY = frameMinimum
              worstTime = (now - started) / 1000
            }
            if (now - started < (duration + 0.35) * 1000)
              requestAnimationFrame(observe)
            else resolve()
          }
          requestAnimationFrame(observe)
        })
        dog.paused = true
        return { name, minimumY, worstTime }
      },
      { name, duration },
    )
    measurements.push(result)
    await page.screenshot({ path: `work/tricolor/floor-${name}.png` })
  }
  writeFileSync(
    "work/tricolor/actual-floor-check.json",
    `${JSON.stringify(measurements, null, 2)}\n`,
  )
  for (const result of measurements)
    expect(result.minimumY, result.name).toBeGreaterThan(-0.013)
})
