import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import type { SparkRenderer } from "@sparkjsdev/spark"
import type * as THREE from "three"

test.beforeEach(async ({ page }) => {
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      body: readFileSync("work/test-rig.glb"),
      contentType: "model/gltf-binary",
    }),
  )
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
})

test("drains an active Gaussian sort before pagehide disposes its targets", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  const result = await page.evaluate(
    () =>
      new Promise<{
        error: string | null
        disposed: boolean
      }>((resolve) => {
        const sandbox = window.dogSandbox as typeof window.dogSandbox & {
          renderer: THREE.WebGLRenderer
        }
        const renderer = sandbox.renderer
        const render = renderer.render
        renderer.render = (scene, camera) => {
          renderer.render = render
          render.call(renderer, scene, camera)
          const spark = scene.children.find(
            (object) => "sorting" in object && "autoUpdate" in object,
          ) as SparkRenderer | undefined
          if (!spark) throw new Error("The Gaussian renderer is missing")
          spark.autoUpdate = false
          spark.sortDirty = false
          const start = async () => {
            while (spark.sorting)
              await new Promise((done) => setTimeout(done, 0))
            // Hold a real sort across the lifecycle event.
            spark.readPause = 250
            spark.minSortIntervalMs = 0
            spark.sortDirty = true
            const pending = spark.update({
              scene: scene as THREE.Scene,
              camera,
            })
            window.dispatchEvent(new Event("pagehide"))
            let error: string | null = null
            try {
              await pending
            } catch (failure) {
              error = String((failure as Error).stack ?? failure)
            }
            await new Promise((done) => setTimeout(done, 50))
            resolve({ error, disposed: spark.current.target === null })
          }
          void start()
        }
      }),
  )
  expect(result.error).toBeNull()
  expect(result.disposed).toBe(true)
  expect(errors).toEqual([])
})

test("keeps the viewer live when pagehide preserves the page in cache", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  const initialFrame = await page.evaluate(() => {
    const sandbox = window.dogSandbox as typeof window.dogSandbox & {
      renderer: THREE.WebGLRenderer
    }
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    )
    return sandbox.renderer.info.render.frame
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sandbox = window.dogSandbox as typeof window.dogSandbox & {
          renderer: THREE.WebGLRenderer
        }
        return sandbox.renderer.info.render.frame
      }),
    )
    .toBeGreaterThan(initialFrame + 2)
  await page.getByRole("button", { name: "Walk", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("WALK")
  expect(errors).toEqual([])
})
