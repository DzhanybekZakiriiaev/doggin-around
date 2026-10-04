import { expect, test } from "@playwright/test"
import { DOG_ACTIONS } from "../../src/dog"
import { loopingActions, rigWithActions } from "./sandbox"

test.beforeEach(async ({ page }) => {
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      body: rigWithActions(DOG_ACTIONS.map(({ name }) => name)),
      contentType: "model/gltf-binary",
    }),
  )
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
})

test("exposes all available actions and preserves loop, hold, and gesture behavior", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await expect(page.locator("#asset-detail")).toHaveText(
    "11 motion clips · textured skin · live rig",
  )
  for (const { name, label } of DOG_ACTIONS) {
    const returnsToIdle = !loopingActions.has(name) && name !== "sit"
    const button = page.getByRole("button", { name: label, exact: true })
    await button.click()
    await expect(page.locator("#action-status")).toHaveText(label.toUpperCase())
    await expect(button).toHaveAttribute("aria-pressed", "true")
    const result = await page.evaluate(() => {
      const dog = window.dogSandbox.dog
      for (let step = 0; step < 45; step++) dog.update(0.1)
      const held = dog.group.getObjectByName("root")?.quaternion.toArray()
      for (let step = 0; step < 5; step++) dog.update(0.1)
      return {
        action: dog.action,
        held,
        later: dog.group.getObjectByName("root")?.quaternion.toArray(),
      }
    })
    expect(result.action).toBe(returnsToIdle ? "idle" : name)
    if (name === "sit") {
      expect(result.held).toBeDefined()
      expect(result.later).toEqual(result.held)
    }
    await expect(page.locator("#action-status")).toHaveText(
      returnsToIdle ? "IDLE" : label.toUpperCase(),
    )
  }
  await page.getByRole("button", { name: "Jump", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("JUMP")
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  expect(await page.evaluate(() => window.dogSandbox.dog.paused)).toBe(true)
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  await expect(
    page.getByRole("button", { name: "Idle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  expect(errors).toEqual([])
})

test("supports an idle-only import and retains it after a clip validation error", async ({
  page,
}) => {
  await page.route("**/idle-only.glb", (route) =>
    route.fulfill({
      body: rigWithActions(["idle"]),
      contentType: "model/gltf-binary",
    }),
  )
  await page.route("**/missing-idle.glb", (route) =>
    route.fulfill({
      body: rigWithActions(["walk", "spin"]),
      contentType: "model/gltf-binary",
    }),
  )
  await page.evaluate(() => window.dogSandbox.loadDog("/idle-only.glb"))
  await expect(page.locator("#notice")).toBeHidden()
  await expect(page.locator("#asset-detail")).toHaveText(
    "1 motion clip · textured skin · live rig",
  )
  await expect(page.locator("[data-action]:visible")).toHaveCount(1)
  await expect(
    page.getByRole("button", { name: "Idle", exact: true }),
  ).toBeEnabled()
  await expect(page.locator("#fetch-demo")).toBeDisabled()
  await expect(page.locator("#fetch-status")).toHaveText("DRAG TO ORBIT")
  const viewport = page.locator("#viewport")
  const size = await viewport.boundingBox()
  if (!size) throw new Error("The playground is missing")
  await viewport.click({
    position: { x: size.width * 0.65, y: size.height * 0.75 },
  })
  await expect(page.locator("#fetch-status")).toHaveText("DRAG TO ORBIT")
  await page.evaluate(() => window.dogSandbox.loadDog("/missing-idle.glb"))
  await expect(page.locator("#notice")).toContainText("Missing idle clip")
  await expect(
    page.getByRole("button", { name: "Idle", exact: true }),
  ).toBeEnabled()
  expect(
    await page.evaluate(() => window.dogSandbox.dog.availableActions),
  ).toEqual(["idle"])
})

test("fits the full action grid on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  const bounds = await page.locator(".actions").boundingBox()
  if (!bounds) throw new Error("The action controls are missing")
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await expect(
    page.getByRole("button", { name: "Play bow", exact: true }),
  ).toBeVisible()
})

test("keeps the playground below its heading at desktop and phone sizes", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => document.fonts.ready)
    const heading = await page.locator(".scene-heading").boundingBox()
    const playground = await page.locator("#viewport").boundingBox()
    if (!heading || !playground) throw new Error("The studio layout is missing")
    expect(playground.y).toBeGreaterThanOrEqual(heading.y + heading.height + 12)
    expect(playground.height).toBeGreaterThan(300)
  }
})

test("plays bark audio on command and stops it with pause, reset, and other actions", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const audio = page.locator("#bark-audio")
  await expect
    .poll(() =>
      audio.evaluate((element) => (element as HTMLAudioElement).readyState),
    )
    .toBeGreaterThan(0)
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await expect
    .poll(() =>
      audio.evaluate((element) => (element as HTMLAudioElement).paused),
    )
    .toBe(false)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  await expect
    .poll(() =>
      audio.evaluate((element) => (element as HTMLAudioElement).paused),
    )
    .toBe(false)
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  expect(
    await audio.evaluate((element) => ({
      paused: (element as HTMLAudioElement).paused,
      time: (element as HTMLAudioElement).currentTime,
    })),
  ).toEqual({ paused: true, time: 0 })
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await page.getByRole("button", { name: "Idle", exact: true }).click()
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")))
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  expect(errors).toEqual([])
})

test("keeps controls working when bark audio playback is rejected", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException("Playback blocked", "NotAllowedError"))
  })
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("BARK")
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  expect(errors).toEqual([])
})

test("repeats the short bark three times during the gesture", async ({
  page,
}) => {
  const audio = page.locator("#bark-audio")
  await audio.evaluate((element) => {
    element.setAttribute("data-plays", "0")
    element.addEventListener("play", () => {
      element.setAttribute(
        "data-plays",
        String(Number(element.getAttribute("data-plays")) + 1),
      )
    })
  })
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await expect(audio).toHaveAttribute("data-plays", "3", { timeout: 5000 })
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
})

test("runs to a distant fetch and returns to idle", async ({ page }) => {
  await page.getByRole("button", { name: "Toss the ball" }).click()
  await expect(page.locator("#action-status")).toHaveText("RUN")
  await expect(page.locator("#fetch-status")).toHaveText(
    "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT",
    { timeout: 15000 },
  )
  await expect(page.locator("#action-status")).toHaveText("IDLE")
})
