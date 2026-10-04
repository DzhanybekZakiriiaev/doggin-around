import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { DOG_ACTIONS } from "../../src/dog"

const requiredActions = [
  "idle",
  "walk",
  "run",
  "sit",
  "jump",
  "bark",
  "paw",
  "spin",
  "playbow",
  "sniff",
  "dig",
  "wag",
]

test.skip(
  !existsSync("public/models/tricolor-research/manifest.json"),
  "The licensed research model is available only in the local demo",
)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("tricolor")
  await expect(page.locator("#asset-name")).toHaveText("Tricolor dog", {
    timeout: 60000,
  })
  await expect(page.locator("#notice")).toBeHidden()
})

test("the reconstructed dog plays every action and completes fetch", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const structure = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    let bones = 0
    dog.group.traverse((object) => {
      if ("isBone" in object) bones++
    })
    return {
      bones,
      actions: dog.availableActions,
      faceBound: dog.hasFaceAppearance,
    }
  })
  expect(structure.bones).toBe(35)
  expect(structure.actions).toEqual(requiredActions)
  expect(structure.faceBound).toBe(true)
  const directory = "work/tricolor/browser-views"
  mkdirSync(directory, { recursive: true })
  const manifest = JSON.parse(
    readFileSync("public/models/tricolor-research/manifest.json", "utf8"),
  ) as { clips: { name: string; duration: number }[] }
  const frontYaw = await page.evaluate(() => {
    const { camera } = window.dogSandbox as typeof window.dogSandbox & {
      camera: import("three").PerspectiveCamera
    }
    return -Math.atan2(camera.position.x, -camera.position.z)
  })
  for (const [name, yaw] of [
    ["front", frontYaw],
    ["side", frontYaw + Math.PI / 2],
    ["rear", frontYaw + Math.PI],
    ["three-quarter", frontYaw - Math.PI / 4],
  ] as const) {
    await page.evaluate((yaw) => {
      const dog = window.dogSandbox.dog
      dog.paused = true
      dog.group.rotation.y = yaw
    }, yaw)
    await page.locator("#viewport").screenshot({
      path: `${directory}/${name}.png`,
    })
  }
  await page.evaluate(() => {
    window.dogSandbox.dog.group.rotation.y = 0
    window.dogSandbox.dog.paused = false
  })
  for (const { name, label, playback } of DOG_ACTIONS.filter(({ name }) =>
    requiredActions.includes(name),
  )) {
    await page.getByRole("button", { name: label, exact: true }).click()
    await expect(page.locator("#action-status")).toHaveText(label.toUpperCase())
    const duration = manifest.clips.find((clip) => clip.name === name)?.duration
    if (duration === undefined) throw new Error(`Missing ${name} clip`)
    await page.evaluate((seconds) => {
      const dog = window.dogSandbox.dog
      for (let frame = 0; frame < Math.floor(seconds * 30); frame++)
        dog.update(1 / 30)
      dog.paused = true
    }, duration * 0.5)
    await page.locator("#viewport").screenshot({
      path: `${directory}/${name}.png`,
    })
    const completed = await page.evaluate(() => {
      const dog = window.dogSandbox.dog
      dog.paused = false
      for (let frame = 0; frame < 150; frame++) dog.update(1 / 30)
      return dog.action
    })
    expect(completed).toBe(playback === "once" ? "idle" : name)
  }
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  await page.locator("#fetch-demo").click()
  await expect(page.locator("#fetch-status")).toHaveText("BRINGING IT BACK", {
    timeout: 30000,
  })
  await expect(page.locator("#action-status")).toHaveText("IDLE", {
    timeout: 30000,
  })
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("huawei")
  await expect(page.locator("#asset-name")).toHaveText("Huawei's dog")
  expect(
    await page.evaluate(() => window.dogSandbox.dog.hasFaceAppearance),
  ).toBe(false)
  expect(errors).toEqual([])
})

test("measures reconstructed density performance at 1440 by 960", async ({
  page,
}) => {
  test.setTimeout(120000)
  const maximum = await page.evaluate(() => window.dogSandbox.dog.maxDensity)
  const display = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#viewport canvas")
    if (!canvas) throw new Error("Missing playground canvas")
    return {
      pixelRatio: window.devicePixelRatio,
      drawingBuffer: { width: canvas.width, height: canvas.height },
      userAgent: navigator.userAgent,
    }
  })
  const measurements: {
    count: number
    drawingBuffer: { width: number; height: number }
    samples: number[]
    minimum: number
  }[] = []
  const requestedPresets = [50000, 100000, 150000]
  const presets = requestedPresets.filter((count) => count <= maximum)
  const densities = presets.length ? presets : [maximum]
  for (const drawingBuffer of [
    display.drawingBuffer,
    { width: 1440, height: 960 },
  ]) {
    for (const count of densities) {
      await page.locator("#density").fill(String(count))
      await page.locator("#density").dispatchEvent("change")
      await expect(page.locator("#splat-count")).toHaveText(
        count.toLocaleString(),
      )
      await page.getByRole("button", { name: "Walk", exact: true }).click()
      await page.evaluate(({ width, height }) => {
        const sandbox = window.dogSandbox as typeof window.dogSandbox & {
          renderer: {
            setSize: (
              width: number,
              height: number,
              updateStyle: boolean,
            ) => void
          }
        }
        sandbox.renderer.setSize(width, height, false)
      }, drawingBuffer)
      await page.waitForTimeout(2200)
      const samples: number[] = []
      for (let sample = 0; sample < 5; sample++) {
        await page.waitForTimeout(1100)
        samples.push(Number(await page.locator("#fps").textContent()))
      }
      const actualBuffer = await page.evaluate(() => {
        const canvas =
          document.querySelector<HTMLCanvasElement>("#viewport canvas")
        if (!canvas) throw new Error("Missing playground canvas")
        return { width: canvas.width, height: canvas.height }
      })
      expect(actualBuffer).toEqual(drawingBuffer)
      expect(samples.every((fps) => Number.isFinite(fps) && fps > 0)).toBe(true)
      measurements.push({
        count,
        drawingBuffer: actualBuffer,
        samples,
        minimum: Math.min(...samples),
      })
    }
  }
  const selected = densities
    .filter((count) =>
      measurements
        .filter((measurement) => measurement.count === count)
        .every(({ minimum }) => minimum >= 45),
    )
    .at(-1)
  writeFileSync(
    "work/tricolor/browser-performance.json",
    `${JSON.stringify({ viewport: page.viewportSize(), browser: "Chrome", display, maximum, availablePresets: presets, unavailablePresets: requestedPresets.filter((count) => count > maximum), measurements, selected }, null, 2)}\n`,
  )
  expect(selected).toBeDefined()
  console.log("TRICOLOR_DENSITY_PERFORMANCE", JSON.stringify(measurements))
})
