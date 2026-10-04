import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import type { Dog, DogAppearance } from "../../src/dog"

declare global {
  interface Window {
    dogSandbox: {
      dog: Dog
      loadDog: (
        url: string,
        name?: string,
        appearance?: DogAppearance,
      ) => Promise<boolean>
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      path: "work/test-rig.glb",
      contentType: "model/gltf-binary",
    }),
  )
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
})

test("renders a skinned splat asset and controls looping and one-shot clips", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await expect(page.locator("#splat-count")).toHaveText("50,000")
  const image = PNG.sync.read(await page.locator("#viewport").screenshot())
  let visiblePixels = 0
  for (let pixel = 0; pixel < image.data.length; pixel += 4) {
    const [red, green, blue] = image.data.subarray(pixel, pixel + 3)
    if (red > green + 20 && green > blue + 10 && blue < 160) visiblePixels++
  }
  expect(visiblePixels).toBeGreaterThan(500)
  await page.getByRole("button", { name: "Walk", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("WALK")
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  expect(await page.evaluate(() => window.dogSandbox.dog.paused)).toBe(true)
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  await page.getByRole("button", { name: "Spin", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("SPIN")
  await expect(page.locator("#action-status")).toHaveText("IDLE", {
    timeout: 15000,
  })
  await page.getByRole("button", { name: "Mesh", exact: true }).click()
  await expect(page.locator("#render-status")).toHaveText("MESH INSPECTION")
  await page.getByRole("button", { name: "Skeleton", exact: true }).click()
  await page.getByRole("button", { name: "Splats", exact: true }).click()
  await page.locator("#density").fill("10000")
  await page.locator("#density").dispatchEvent("change")
  await expect(page.locator("#splat-count")).toHaveText("10,000")
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  expect(errors).toEqual([])
})

test("replaces an asset and retains a working dog after an invalid import", async ({
  page,
}) => {
  await page.locator("#model-upload").setInputFiles("work/test-rig.glb")
  await expect(page.locator("#asset-name")).toHaveText("test-rig.glb")
  await expect(page.locator("#notice")).toBeHidden()
  await page.locator("#model-upload").setInputFiles({
    name: "broken.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("broken"),
  })
  await expect(page.locator("#notice")).toBeVisible()
  await page.getByRole("button", { name: "Walk", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("WALK")
  expect(await page.evaluate(() => window.dogSandbox.dog.sampleCount)).toBe(
    50000,
  )
})

test("fits a phone screen without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await expect(
    page.getByRole("button", { name: "Spin", exact: true }),
  ).toBeVisible()
})

test("fetching a ball moves the dog through the scene and returns it home", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByRole("button", { name: "Toss the ball" }).click()
  await expect(page.locator("#fetch-status")).toHaveText("FETCHING THE BALL")
  await expect(page.locator("#fetch-status")).toHaveText(
    "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT",
    { timeout: 15000 },
  )
  const state = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    return { position: dog.group.position.toArray(), action: dog.action }
  })
  expect(state.position[0]).toBeCloseTo(0, 1)
  expect(state.position[2]).toBeCloseTo(0, 1)
  expect(state.action).toBe("idle")
  const viewport = page.locator("#viewport")
  const size = await viewport.boundingBox()
  if (!size) throw new Error("The playground is missing")
  await viewport.click({
    position: { x: size.width * 0.65, y: size.height * 0.75 },
  })
  await expect(page.locator("#fetch-status")).toHaveText("FETCHING THE BALL")
  expect(errors).toEqual([])
})
