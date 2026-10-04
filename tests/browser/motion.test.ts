import { expect, test } from "@playwright/test"

test("the captured dog keeps body motion and continuous grounded gait loops", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const results = await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const rig = dog.group.getObjectByName("joint_18")
    if (!rig) throw new Error("The dog is missing its pelvis")
    const feet = ["joint_6", "joint_34", "joint_3", "joint_38"].map((name) =>
      dog.group.getObjectByName(name),
    )
    if (feet.some((foot) => !foot)) throw new Error("The paws are missing")
    const wrists = ["joint_8", "joint_36"].map((name) =>
      dog.group.getObjectByName(name),
    )
    if (wrists.some((wrist) => !wrist))
      throw new Error("The front wrists are missing")
    const inspection = dog as unknown as {
      active: import("three").AnimationAction
    }
    return (["walk", "run"] as const).map((name) => {
      dog.paused = false
      dog.playAction(name)
      for (let step = 0; step < 5; step++) dog.update(0.1)
      dog.paused = true
      const action = inspection.active
      const duration = action.getClip().duration
      const joints: import("three").Object3D[] = []
      rig.traverse((object) => {
        if ("isBone" in object) joints.push(object)
      })
      const sample = (time: number) => {
        action.time = time
        dog.update(0)
        return joints.map((bone) => ({
          position: bone.matrixWorld.elements.slice(12, 15),
          rotation: bone.quaternion.clone(),
        }))
      }
      const epsilon = 1 / 120
      const first = sample(0)
      const pawPlane = Math.min(
        ...feet.map((foot) => foot?.matrixWorld.elements[13] ?? Infinity),
      )
      const after = sample(epsilon)
      const before = sample(duration - epsilon)
      const last = sample(duration)
      const seamGap = Math.max(
        ...first.map((pose, index) =>
          Math.hypot(
            ...pose.position.map(
              (component, axis) => component - last[index].position[axis],
            ),
          ),
        ),
      )
      const seamVelocityGap = Math.max(
        ...first.map((pose, index) =>
          Math.hypot(
            ...pose.position.map(
              (component, axis) =>
                (after[index].position[axis] -
                  component -
                  (last[index].position[axis] - before[index].position[axis])) /
                epsilon,
            ),
          ),
        ),
      )
      const seamVelocityByJoint = first
        .map((pose, index) => ({
          name: joints[index].name,
          speed: Math.hypot(
            ...pose.position.map(
              (component, axis) =>
                (after[index].position[axis] -
                  component -
                  (last[index].position[axis] - before[index].position[axis])) /
                epsilon,
            ),
          ),
        }))
        .sort((a, b) => b.speed - a.speed)
        .slice(0, 4)
      let bodyMotion = 0
      let minimumPaw = Infinity
      let largestStep = 0
      let largestStepJoint = ""
      let largestStepTime = 0
      let maxFrontWristAngle = 0
      let lowestPaw = ""
      let lowestPawTime = 0
      const bodyReference = rig.quaternion.clone()
      let previous = first
      for (let frame = 0; frame <= Math.ceil(duration * 60); frame++) {
        const current = sample(Math.min(duration, frame / 60))
        bodyMotion = Math.max(bodyMotion, bodyReference.angleTo(rig.quaternion))
        minimumPaw = Math.min(
          minimumPaw,
          ...feet.map(
            (foot) => (foot?.matrixWorld.elements[13] ?? Infinity) - pawPlane,
          ),
        )
        maxFrontWristAngle = Math.max(
          maxFrontWristAngle,
          ...wrists.map(
            (wrist) =>
              2 * Math.acos(Math.min(1, Math.abs(wrist?.quaternion.w ?? 1))),
          ),
        )
        for (const foot of feet) {
          const height = (foot?.matrixWorld.elements[13] ?? Infinity) - pawPlane
          if (height <= minimumPaw) {
            lowestPaw = foot?.name ?? ""
            lowestPawTime = frame / 60
          }
        }
        for (const [index, pose] of current.entries()) {
          const step = pose.rotation.angleTo(previous[index].rotation)
          if (step > largestStep) {
            largestStepJoint = joints[index].name
            largestStepTime = frame / 60
          }
        }
        largestStep = Math.max(
          largestStep,
          ...current.map((pose, index) =>
            pose.rotation.angleTo(previous[index].rotation),
          ),
        )
        previous = current
      }
      return {
        name,
        duration,
        bodyMotion,
        seamGap,
        seamVelocityGap,
        minimumPaw,
        largestStep,
        largestStepJoint,
        largestStepTime,
        maxFrontWristAngle,
        lowestPaw,
        lowestPawTime,
        seamVelocityByJoint,
      }
    })
  })
  console.log("GAIT_METRICS", JSON.stringify(results))
  for (const name of ["walk", "run"] as const) {
    await page.evaluate((actionName) => {
      const dog = window.dogSandbox.dog
      dog.paused = false
      dog.playAction(actionName)
      for (let step = 0; step < 5; step++) dog.update(0.1)
      dog.paused = true
    }, name)
    await page.screenshot({ path: `work/joint-improved-${name}.png` })
  }
  for (const result of results) {
    expect(result.bodyMotion, `${result.name} pelvis movement`).toBeGreaterThan(
      0.015,
    )
    expect(result.seamGap, `${result.name} loop position`).toBeLessThan(0.01)
    expect(result.seamVelocityGap, `${result.name} loop velocity`).toBeLessThan(
      0.5,
    )
    expect(
      result.minimumPaw,
      `${result.name} ground penetration`,
    ).toBeGreaterThan(-0.015)
    expect(
      result.largestStep,
      `${result.name} joint discontinuity`,
    ).toBeLessThan(0.25)
    expect(
      result.maxFrontWristAngle,
      `${result.name} front wrist bend`,
    ).toBeLessThan(0.45)
  }
})

test("the dog articulates its tail and keeps support paws planted while offering a paw", async ({
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
      if (!bone) throw new Error(`The dog is missing ${name}`)
      return bone
    }
    const tails = ["joint_15", "joint_16", "joint_19", "joint_26"].map(joint)
    const supports = ["joint_34", "joint_3", "joint_38"].map(joint)
    const settle = (name: "wag" | "paw") => {
      dog.paused = false
      dog.playAction(name)
      for (let step = 0; step < 5; step++) dog.update(0.1)
      dog.paused = true
      inspection.active.time = 0
      dog.update(0)
    }
    settle("wag")
    const rest = tails.map((bone) => bone.quaternion.clone())
    const tailMotion = tails.map(() => 0)
    for (let frame = 0; frame < 60; frame++) {
      inspection.active.time = frame / 30
      dog.update(0)
      for (const [index, bone] of tails.entries())
        tailMotion[index] = Math.max(
          tailMotion[index],
          rest[index].angleTo(bone.quaternion),
        )
    }
    settle("paw")
    const starting = supports.map((bone) =>
      bone.matrixWorld.elements.slice(12, 15),
    )
    let supportDrift = 0
    for (let frame = 0; frame <= 90; frame++) {
      inspection.active.time = frame / 30
      dog.update(0)
      for (const [index, bone] of supports.entries())
        supportDrift = Math.max(
          supportDrift,
          Math.hypot(
            ...starting[index].map(
              (component, axis) =>
                bone.matrixWorld.elements[12 + axis] - component,
            ),
          ),
        )
    }
    return { tailMotion, supportDrift }
  })
  for (const motion of result.tailMotion) expect(motion).toBeGreaterThan(0.01)
  expect(result.supportDrift).toBeLessThan(0.035)
})
