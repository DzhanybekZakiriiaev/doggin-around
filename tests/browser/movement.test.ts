import { expect, test } from "@playwright/test"

test("sitting folds from the hips without reversing the lower legs", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const result = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const inspection = dog as unknown as {
      active: import("three").AnimationAction
    }
    const joint = (name: string) => {
      const bone = dog.group.getObjectByName(name)
      if (!bone) throw new Error(`Missing ${name}`)
      return bone
    }
    const hips = ["joint_12", "joint_28"].map(joint)
    const knees = ["joint_10", "joint_30", "joint_11", "joint_32"].map(joint)
    const paws = ["joint_6", "joint_34", "joint_3", "joint_38"].map(joint)
    dog.paused = false
    dog.playAction("sit")
    for (let frame = 0; frame < 30; frame++) dog.update(1 / 60)
    dog.paused = true
    inspection.active.time = 0
    dog.update(0)
    const floor = paws.map((bone) => bone.matrixWorld.elements[13])
    const initialHips = hips.map((bone) => bone.quaternion.clone())
    let maximumBend = 0
    let floorDrift = 0
    for (let frame = 0; frame <= 150; frame++) {
      inspection.active.time = frame / 60
      dog.update(0)
      for (const bone of knees)
        maximumBend = Math.max(
          maximumBend,
          2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w))),
        )
      paws.forEach((bone, index) => {
        floorDrift = Math.max(
          floorDrift,
          Math.abs(bone.matrixWorld.elements[13] - floor[index]),
        )
      })
    }
    return {
      maximumBend,
      floorDrift,
      hipMotion: hips.map((bone, index) =>
        bone.quaternion.angleTo(initialHips[index]),
      ),
    }
  })
  console.log("SIT_POSE", JSON.stringify(result))
  expect(result.maximumBend).toBeLessThan(2.4)
  expect(result.floorDrift).toBeLessThan(0.02)
  for (const motion of result.hipMotion) expect(motion).toBeGreaterThan(0.4)
})

test("fetch accelerates and brakes without abrupt body motion", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await expect(
    page.getByRole("button", { name: "Toss the ball" }),
  ).toBeEnabled()
  const result = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#fetch-demo")?.click()
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const previous = dog.group.position.clone()
    let previousSpeed = 0
    let previousYaw = dog.group.rotation.y
    let previousTurnRate = 0
    let largestSpeedChange = 0
    let largestTurnRateChange = 0
    const stages = new Set<string>()
    let elapsed = 0
    for (let frame = 0; frame < 1500; frame++) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
      fetchPlay.updateBallPosition()
      const speed = dog.group.position.distanceTo(previous) * 60
      const yawChange = dog.group.rotation.y - previousYaw
      const turnRate = Math.atan2(Math.sin(yawChange), Math.cos(yawChange)) * 60
      largestSpeedChange = Math.max(
        largestSpeedChange,
        Math.abs(speed - previousSpeed),
      )
      largestTurnRateChange = Math.max(
        largestTurnRateChange,
        Math.abs(turnRate - previousTurnRate),
      )
      previous.copy(dog.group.position)
      previousSpeed = speed
      previousYaw = dog.group.rotation.y
      previousTurnRate = turnRate
      stages.add(fetchPlay.state)
      elapsed += 1 / 60
      if (fetchPlay.state === "idle") break
    }
    return {
      largestSpeedChange,
      largestTurnRateChange,
      stages: [...stages],
      elapsed,
    }
  })
  console.log("MOVEMENT", JSON.stringify(result))
  expect(result.stages).toEqual(
    expect.arrayContaining(["chasing", "picking-up", "returning", "idle"]),
  )
  expect(result.largestSpeedChange).toBeLessThan(0.16)
  expect(result.largestTurnRateChange).toBeLessThan(0.4)
  expect(result.elapsed).toBeLessThan(20)
})

test("head tracking leads a turn and does not accumulate during pause", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const result = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const neck = dog.group.getObjectByName("joint_22")
    if (!neck) throw new Error("Missing neck")
    dog.paused = false
    dog.playAction("idle")
    for (let frame = 0; frame < 30; frame++) dog.update(1 / 60)
    const action = (
      dog as unknown as { active: import("three").AnimationAction }
    ).active
    action.paused = true
    const start = neck.quaternion.clone()
    dog.lookToward(1)
    for (let frame = 0; frame < 60; frame++) dog.update(1 / 60)
    const turned = neck.quaternion.clone()
    dog.paused = true
    for (let frame = 0; frame < 120; frame++) dog.update(1 / 60)
    const pauseDrift = neck.quaternion.angleTo(turned)
    dog.paused = false
    dog.lookToward(0)
    for (let frame = 0; frame < 90; frame++) dog.update(1 / 60)
    const resetError = neck.quaternion.angleTo(start)
    return { turn: start.angleTo(turned), pauseDrift, resetError }
  })
  expect(result.turn).toBeGreaterThan(0.2)
  expect(result.turn).toBeLessThan(0.4)
  expect(result.pauseDrift).toBeLessThan(0.001)
  expect(result.resetError).toBeLessThan(0.001)
})

test("contact paws remain near their planted point during travel", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const result = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const inspection = dog as unknown as {
      pawContacts: {
        legs: Array<{
          toe: import("three").Object3D
          target: import("three").Vector3
          weight: number
          planted: boolean
        }>
      }
    }
    dog.paused = false
    dog.playAction("walk")
    dog.setActionRate(0.6)
    let contactFrames = 0
    let largestError = 0
    for (let frame = 0; frame < 240; frame++) {
      dog.group.position.z -= 1.35 / 60
      dog.update(1 / 60)
      for (const leg of inspection.pawContacts.legs) {
        if (!leg.planted || leg.weight < 0.95) continue
        contactFrames++
        largestError = Math.max(
          largestError,
          leg.toe.getWorldPosition(leg.target.clone()).distanceTo(leg.target),
        )
      }
    }
    const before = inspection.pawContacts.legs.map((leg) =>
      leg.toe.getWorldPosition(leg.target.clone()),
    )
    dog.paused = true
    for (let frame = 0; frame < 30; frame++) dog.update(1 / 60)
    const pauseDrift = Math.max(
      ...inspection.pawContacts.legs.map((leg, index) =>
        leg.toe.getWorldPosition(leg.target.clone()).distanceTo(before[index]),
      ),
    )
    return { contactFrames, largestError, pauseDrift }
  })
  console.log("PAW_CONTACTS", JSON.stringify(result))
  expect(result.contactFrames).toBeGreaterThan(25)
  expect(result.largestError).toBeLessThan(0.025)
  expect(result.pauseDrift).toBeLessThan(0.001)
})
