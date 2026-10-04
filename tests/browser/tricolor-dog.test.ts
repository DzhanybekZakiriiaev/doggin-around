import { existsSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { DOG_ACTIONS } from "../../src/dog"

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
  expect(structure.actions).toEqual(DOG_ACTIONS.map(({ name }) => name))
  expect(structure.faceBound).toBe(true)
  for (const { name, label, playback } of DOG_ACTIONS) {
    await page.getByRole("button", { name: label, exact: true }).click()
    await expect(page.locator("#action-status")).toHaveText(label.toUpperCase())
    const completed = await page.evaluate(() => {
      const dog = window.dogSandbox.dog
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
  const measurements: { count: number; samples: number[]; minimum: number }[] =
    []
  for (const count of [50000, 100000, 150000]) {
    if (count > maximum) continue
    await page.locator("#density").fill(String(count))
    await page.locator("#density").dispatchEvent("change")
    await expect(page.locator("#splat-count")).toHaveText(
      count.toLocaleString(),
    )
    await page.getByRole("button", { name: "Walk", exact: true }).click()
    await page.waitForTimeout(2200)
    const samples: number[] = []
    for (let sample = 0; sample < 5; sample++) {
      await page.waitForTimeout(1100)
      samples.push(Number(await page.locator("#fps").textContent()))
    }
    measurements.push({ count, samples, minimum: Math.min(...samples) })
  }
  const passing = measurements.filter(({ minimum }) => minimum >= 45)
  const selected = passing.at(-1)?.count
  writeFileSync(
    "work/tricolor/browser-performance.json",
    `${JSON.stringify({ viewport: { width: 1440, height: 960 }, browser: "Chrome", maximum, measurements, selected }, null, 2)}\n`,
  )
  expect(selected).toBeDefined()
  console.log("TRICOLOR_DENSITY_PERFORMANCE", JSON.stringify(measurements))
})
