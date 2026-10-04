import { expect, test } from "@playwright/test"

test("jump lifts the front paws first and lands front before hind", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await page.getByRole("button", { name: "Jump", exact: true }).click()
  const result = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const inspection = dog as unknown as {
      active: import("three").AnimationAction
    }
    let elapsed = 0
    while (elapsed < 0.4) {
      dog.update(1 / 60)
      elapsed += 1 / 60
    }
    dog.paused = true
    const action = inspection.active
    const duration = action.getClip().duration
    const paws = ["joint_6", "joint_34", "joint_3", "joint_38"].map((name) => {
      const bone = dog.group.getObjectByName(name)
      if (!bone) throw new Error(`Missing ${name}`)
      return bone
    })
    action.time = 0
    dog.update(0)
    const floor = paws.map((bone) => bone.matrixWorld.elements[13])
    const joints: import("three").Object3D[] = []
    dog.group.traverse((object) => {
      if ("isBone" in object) joints.push(object)
    })
    let previous = joints.map((bone) => bone.quaternion.clone())
    let largestJointStep = 0
    const samples: {
      time: number
      heights: number[]
    }[] = []
    let frame = 0
    while (frame <= Math.round(duration * 120)) {
      action.time = Math.min(duration, frame / 120)
      dog.update(0)
      joints.forEach((bone, index) => {
        largestJointStep = Math.max(
          largestJointStep,
          bone.quaternion.angleTo(previous[index]),
        )
      })
      previous = joints.map((bone) => bone.quaternion.clone())
      samples.push({
        time: action.time,
        heights: paws.map(
          (bone, index) => bone.matrixWorld.elements[13] - floor[index],
        ),
      })
      frame++
    }
    const timings = paws.map((_, index) => {
      const apex = samples.reduce(
        (best, sample, i) =>
          sample.heights[index] > samples[best].heights[index] ? i : best,
        0,
      )
      return {
        lift: samples.find((sample) => sample.heights[index] > 0.04)?.time,
        land: samples.slice(apex).find((sample) => sample.heights[index] < 0.04)
          ?.time,
      }
    })
    return {
      timings,
      largestJointStep,
      minimum: Math.min(...samples.flatMap((sample) => sample.heights)),
      airborne: samples.some((sample) =>
        sample.heights.every((height) => height > 0.12),
      ),
      endHeights: samples.at(-1)?.heights ?? [],
    }
  })
  console.log("JUMP_CONTACTS", JSON.stringify(result))
  const [frontLeft, frontRight, hindLeft, hindRight] = result.timings
  for (const timing of result.timings) {
    expect(timing.lift).toBeDefined()
    expect(timing.land).toBeDefined()
  }
  const frontLift = Math.max(frontLeft.lift ?? 0, frontRight.lift ?? 0)
  const hindLift = Math.min(hindLeft.lift ?? 0, hindRight.lift ?? 0)
  const frontLand = Math.max(frontLeft.land ?? 0, frontRight.land ?? 0)
  const hindLand = Math.min(hindLeft.land ?? 0, hindRight.land ?? 0)
  expect(hindLift - frontLift).toBeGreaterThan(0.12)
  expect(hindLand - frontLand).toBeGreaterThan(0.12)
  expect(result.airborne).toBe(true)
  expect(result.largestJointStep).toBeLessThan(0.15)
  expect(result.minimum).toBeGreaterThan(-0.02)
  for (const height of result.endHeights)
    expect(Math.abs(height)).toBeLessThan(0.02)
})
