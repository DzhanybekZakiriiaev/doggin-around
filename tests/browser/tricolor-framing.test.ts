import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import type * as THREE from "three"
import type { FaceAppearance } from "../../src/faceAppearance"

test.skip(
  !existsSync("public/models/tricolor-research/manifest.json"),
  "The licensed research model is available only in the local demo",
)

test("keeps the Tricolor dog's peak Jump and pickup inside the playground", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
  const originalCamera = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
    }
    return {
      position: sandbox.camera.position.toArray(),
      quaternion: sandbox.camera.quaternion.toArray(),
    }
  })
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("tricolor")
  await expect(page.locator("#asset-name")).toHaveText("Tricolor dog", {
    timeout: 60000,
  })
  const rest = await page.evaluate(() => {
    window.dogSandbox.dog.paused = true
    const dog = window.dogSandbox.dog as unknown as {
      faceAppearance: FaceAppearance
    }
    return Array.from(dog.faceAppearance.vertexPositions)
  })
  await page.getByRole("button", { name: "Jump", exact: true }).click()
  const framing = await page.evaluate((restPositions) => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
    }
    const dog = sandbox.dog
    const face = (
      dog as unknown as {
        faceAppearance: FaceAppearance
      }
    ).faceAppearance
    const clip = face.clips.get("jump")
    const canvas = document.querySelector<HTMLCanvasElement>("#viewport canvas")
    if (!clip || !canvas) throw new Error("Missing actual Jump or canvas")
    face.mesh.updateWorldMatrix(true, false)
    const point = sandbox.camera.position.clone()
    let highest = -Infinity
    let peakTime = 0
    const stride = face.vertexPositions.length
    for (let frame = 0; frame < clip.times.length; frame++) {
      for (let vertex = 0; vertex < stride; vertex += 3) {
        const index = frame * stride + vertex
        face.mesh.localToWorld(
          point.set(
            clip.positions[index],
            clip.positions[index + 1],
            clip.positions[index + 2],
          ),
        )
        if (point.y > highest) {
          highest = point.y
          peakTime = clip.times[frame]
        }
      }
    }
    dog.paused = false
    dog.playAction("jump")
    let elapsed = 0
    while (elapsed < peakTime) {
      const step = Math.min(1 / 60, peakTime - elapsed)
      dog.update(step)
      elapsed += step
    }
    dog.paused = true
    sandbox.camera.updateMatrixWorld(true)
    const bounds = canvas.getBoundingClientRect()
    function margins(positions: ArrayLike<number>) {
      let left = Infinity
      let right = Infinity
      let top = Infinity
      let bottom = Infinity
      for (let vertex = 0; vertex < positions.length; vertex += 3) {
        face.mesh.localToWorld(
          point.set(
            positions[vertex],
            positions[vertex + 1],
            positions[vertex + 2],
          ),
        )
        point.project(sandbox.camera)
        const x = ((point.x + 1) * bounds.width) / 2
        const y = ((1 - point.y) * bounds.height) / 2
        left = Math.min(left, x)
        right = Math.min(right, bounds.width - x)
        top = Math.min(top, y)
        bottom = Math.min(bottom, bounds.height - y)
      }
      return {
        left,
        right,
        top,
        bottom,
        heightFraction: (bounds.height - top - bottom) / bounds.height,
      }
    }
    return {
      camera: sandbox.camera.position.toArray(),
      peakTime,
      viewport: { width: bounds.width, height: bounds.height },
      jump: margins(face.vertexPositions),
      rest: margins(restPositions),
    }
  }, rest)
  mkdirSync("work/tricolor", { recursive: true })
  const label = process.env.TRICOLOR_FRAMING_LABEL ?? "current"
  await page.locator("#viewport").screenshot({
    path: `work/tricolor/framing-${label}.png`,
  })
  writeFileSync(
    `work/tricolor/framing-${label}.json`,
    `${JSON.stringify(framing, null, 2)}\n`,
  )
  expect(framing.jump.top).toBeGreaterThanOrEqual(18)
  expect(framing.jump.bottom).toBeGreaterThanOrEqual(18)
  expect(framing.jump.left).toBeGreaterThanOrEqual(18)
  expect(framing.jump.right).toBeGreaterThanOrEqual(18)
  expect(framing.rest.heightFraction).toBeGreaterThanOrEqual(0.5)
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  const resetCamera = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
    }
    return sandbox.camera.position.toArray()
  })
  resetCamera.forEach((value, index) => {
    expect(value).toBeCloseTo(framing.camera[index], 6)
  })
  await page.getByRole("button", { name: "Toss the ball" }).click()
  await page.waitForFunction(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const active = (sandbox.dog as unknown as { active: THREE.AnimationAction })
      .active
    if (sandbox.fetchPlay.state !== "picking-up" || active.time < 0.85)
      return false
    sandbox.dog.paused = true
    return true
  })
  await expect(page.locator("#fetch-status")).toHaveText("PICKING IT UP")
  const pickup = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const dog = sandbox.dog
    const internal = dog as unknown as {
      faceAppearance: FaceAppearance
      active: THREE.AnimationAction
    }
    dog.group.updateWorldMatrix(true, true)
    sandbox.camera.updateMatrixWorld(true)
    const canvas = document.querySelector<HTMLCanvasElement>("#viewport canvas")
    if (!canvas) throw new Error("Missing playground canvas")
    const bounds = canvas.getBoundingClientRect()
    const face = internal.faceAppearance
    const positions = face.vertexPositions
    const point = sandbox.camera.position.clone()
    let left = Infinity
    let right = Infinity
    let top = Infinity
    let bottom = Infinity
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      face.mesh.localToWorld(
        point.set(
          positions[vertex],
          positions[vertex + 1],
          positions[vertex + 2],
        ),
      )
      point.project(sandbox.camera)
      const x = ((point.x + 1) * bounds.width) / 2
      const y = ((1 - point.y) * bounds.height) / 2
      left = Math.min(left, x)
      right = Math.min(right, bounds.width - x)
      top = Math.min(top, y)
      bottom = Math.min(bottom, bounds.height - y)
    }
    return {
      state: sandbox.fetchPlay.state,
      time: internal.active.time,
      left,
      right,
      top,
      bottom,
    }
  })
  await page.locator("#viewport").screenshot({
    path: `work/tricolor/framing-pickup-${label}.png`,
  })
  writeFileSync(
    `work/tricolor/framing-${label}.json`,
    `${JSON.stringify({ ...framing, pickup }, null, 2)}\n`,
  )
  expect(pickup.state).toBe("picking-up")
  expect(pickup.time).toBeGreaterThanOrEqual(0.85)
  expect(pickup.time).toBeLessThan(1.2)
  expect(pickup.bottom).toBeGreaterThanOrEqual(18)
  expect(pickup.top).toBeGreaterThanOrEqual(18)
  expect(pickup.left).toBeGreaterThanOrEqual(18)
  expect(pickup.right).toBeGreaterThanOrEqual(18)
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("huawei")
  await expect(page.locator("#asset-name")).toHaveText("Huawei's dog")
  const huaweiCamera = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
    }
    return {
      position: sandbox.camera.position.toArray(),
      quaternion: sandbox.camera.quaternion.toArray(),
    }
  })
  await page.locator("#model-upload").setInputFiles("work/test-rig.glb")
  await expect(page.locator("#asset-name")).toHaveText("test-rig.glb")
  const restored = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      camera: THREE.PerspectiveCamera
    }
    return {
      position: sandbox.camera.position.toArray(),
      quaternion: sandbox.camera.quaternion.toArray(),
    }
  })
  for (const framing of [huaweiCamera, restored])
    for (const property of ["position", "quaternion"] as const)
      framing[property].forEach((value, index) => {
        expect(value).toBeCloseTo(originalCamera[property][index], 6)
      })
})
