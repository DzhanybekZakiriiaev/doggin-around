import { expect, test } from "@playwright/test"

test("the default dog exposes all actions, barks, fetches at a run, and fits its playground", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const appearance = page.waitForResponse((response) =>
    response.url().endsWith("/models/dog-triposplat-50000.ply"),
  )
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  expect((await appearance).ok()).toBe(true)
  await expect(page.locator("#density")).toHaveAttribute("max", "50000")
  await page.locator("#density").evaluate((element) => {
    const slider = element as HTMLInputElement
    slider.value = "10000"
    slider.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(page.locator("#splat-count")).toHaveText("10,000")
  await expect(page.locator("#density")).toBeEnabled()
  await page.locator("#density").evaluate((element) => {
    const slider = element as HTMLInputElement
    slider.value = "50000"
    slider.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(page.locator("#splat-count")).toHaveText("50,000")
  await expect(page.locator("#density")).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator("[data-action]:visible")).toHaveCount(13)
  await expect(page.locator("#asset-detail")).toHaveText(
    "13 motion clips · textured skin · live rig",
  )
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
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  await page.getByRole("button", { name: "Bark", exact: true }).click()
  await expect(audio).toHaveAttribute("data-plays", "3", { timeout: 5000 })
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true)
  await page.getByRole("button", { name: "Toss the ball" }).click()
  await expect(page.locator("#action-status")).toHaveText("RUN")
  await expect(page.locator("#fetch-status")).toHaveText(
    "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT",
    { timeout: 15000 },
  )
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  const heading = await page.locator(".scene-heading").boundingBox()
  const playground = await page.locator("#viewport").boundingBox()
  if (!heading || !playground) throw new Error("The playground is missing")
  expect(playground.y).toBeGreaterThanOrEqual(heading.y + heading.height + 12)
  expect(playground.y + playground.height).toBeLessThan(960)
  await page.screenshot({ path: "work/default-framing-idle.png" })
  await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    dog.playAction("jump")
    for (let step = 0; step < 12; step++) dog.update(0.1)
  })
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("JUMP")
  expect(await page.evaluate(() => window.dogSandbox.dog.paused)).toBe(true)
  await page.screenshot({ path: "work/default-framing-jump.png" })
  await page.getByRole("button", { name: "Reset pose", exact: true }).click()
  expect(errors).toEqual([])
})
