import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

test("repeated gestures and interrupted blends preserve the rendered pose", async ({
  page,
}) => {
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      body: readFileSync("work/test-rig.glb"),
      contentType: "model/gltf-binary",
    }),
  )
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByRole("button", { name: "Spin", exact: true }).click()
  await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    dog.paused = false
    for (let frame = 0; frame < 8; frame++) dog.update(0.1)
    dog.paused = true
  })
  const beforeRestart = await page.evaluate(() =>
    window.dogSandbox.dog.group.getObjectByName("root")?.quaternion.toArray(),
  )
  const afterRestart = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    document.querySelector<HTMLButtonElement>('[data-action="spin"]')?.click()
    dog.paused = true
    dog.update(0)
    return dog.group.getObjectByName("root")?.quaternion.toArray()
  })
  expect(beforeRestart).toBeDefined()
  expect(afterRestart).toBeDefined()
  for (let component = 0; component < 4; component++)
    expect(afterRestart?.[component]).toBeCloseTo(
      beforeRestart?.[component] ?? 0,
      6,
    )

  const gaps = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const bone = dog.group.getObjectByName("root")
    if (!bone) throw new Error("The test rig is missing its root")
    const differences: number[] = []
    dog.paused = false
    for (const name of ["walk", "spin", "idle", "spin"] as const) {
      dog.update(0.04)
      const previous = bone.quaternion.clone()
      dog.playAction(name)
      dog.update(0)
      differences.push(
        Math.max(
          ...previous
            .toArray()
            .map((component, index) =>
              Math.abs(component - bone.quaternion.toArray()[index]),
            ),
        ),
      )
    }
    dog.update(0.1)
    dog.paused = true
    const held = bone.quaternion.toArray()
    for (let frame = 0; frame < 8; frame++) dog.update(0.1)
    const paused = bone.quaternion.toArray()
    dog.paused = false
    for (let frame = 0; frame < 25; frame++) dog.update(0.02)
    const inspection = dog as unknown as {
      mixer: { stats: { actions: Record<"inUse" | "total", number> } }
    }
    dog.paused = true
    return {
      differences,
      held,
      paused,
      actions: inspection.mixer.stats.actions,
    }
  })
  for (const difference of gaps.differences)
    expect(difference).toBeLessThan(1e-6)
  expect(gaps.paused).toEqual(gaps.held)
  expect(gaps.actions.inUse).toBe(1)
  expect(gaps.actions.total).toBe(3)
})
