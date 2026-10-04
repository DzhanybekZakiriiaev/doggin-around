import { expect, test } from "@playwright/test"

test("dig lowers the chest and alternates grounded scrapes with lifted returns", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const standing = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    return {
      chest:
        dog.group.getObjectByName("joint_23")?.matrixWorld.elements[13] ?? 0,
      paws: ["joint_6", "joint_34", "joint_3", "joint_38"].map(
        (name) =>
          dog.group.getObjectByName(name)?.matrixWorld.elements[13] ?? 0,
      ),
    }
  })
  await page.getByRole("button", { name: "Dig", exact: true }).click()
  const motion = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    let frame = 0
    while (frame++ < 5) dog.update(0.1)
    dog.paused = true
    const action = (
      dog as unknown as { active: import("three").AnimationAction }
    ).active
    const bones = [
      "joint_23",
      "joint_6",
      "joint_34",
      "joint_3",
      "joint_38",
    ].map((name) => {
      const bone = dog.group.getObjectByName(name)
      if (!bone) throw new Error(`Missing ${name}`)
      return bone
    })
    const samples: number[][][] = []
    frame = 0
    while (frame <= 120) {
      action.time = (action.getClip().duration * frame) / 120
      dog.update(0)
      samples.push(bones.map((bone) => bone.matrixWorld.elements.slice(12, 15)))
      frame++
    }
    return { samples, duration: action.getClip().duration }
  })
  const first = motion.samples[0]
  const last = motion.samples.at(-1)
  if (!last) throw new Error("Missing loop endpoint")
  const heights = motion.samples.map((sample) =>
    sample.slice(1).map((paw) => paw[1]),
  )
  expect(
    Math.max(...motion.samples.map((sample) => sample[0][1])),
  ).toBeLessThan(standing.chest - 0.12)
  for (const index of [0, 1]) {
    expect(
      Math.max(...heights.map((pose) => pose[index])) -
        Math.min(...heights.map((pose) => pose[index])),
    ).toBeGreaterThan(0.12)
    const travel = motion.samples.map((sample) => sample[index + 1][2])
    expect(Math.max(...travel) - Math.min(...travel)).toBeGreaterThan(0.2)
  }
  const floors = [0, 1].map((index) =>
    Math.min(...heights.map((pose) => pose[index])),
  )
  expect(
    heights.some(
      (pose) => pose[0] - floors[0] > 0.05 && pose[1] - floors[1] > 0.05,
    ),
  ).toBe(false)
  for (const sample of motion.samples) {
    for (const index of [3, 4])
      expect(
        Math.hypot(
          ...sample[index].map((value, axis) => value - first[index][axis]),
        ),
      ).toBeLessThan(0.01)
    // Toe markers sit below the sole, so use their standing height.
    for (const [index, paw] of sample.slice(1).entries())
      expect(paw[1] - standing.paws[index]).toBeGreaterThan(-0.02)
  }
  for (const [index, position] of first.entries())
    expect(
      Math.hypot(...position.map((value, axis) => value - last[index][axis])),
    ).toBeLessThan(0.001)
  await page.evaluate((duration) => {
    const dog = window.dogSandbox.dog
    dog.paused = false
    let elapsed = 0
    while (elapsed < duration * 3) {
      dog.update(0.1)
      elapsed += 0.1
    }
  }, motion.duration)
  await expect(page.locator("#action-status")).toHaveText("DIG")
  await page.getByRole("button", { name: "Idle", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  expect(errors).toEqual([])
})
