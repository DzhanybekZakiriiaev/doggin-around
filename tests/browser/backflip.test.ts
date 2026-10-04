import { expect, test } from "@playwright/test"

test("backflip rotates once in the air, lands upright, and returns to idle", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await page.getByRole("button", { name: "Backflip", exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window.dogSandbox as typeof window.dogSandbox & {
              camera: import("three").PerspectiveCamera
            }
          ).camera.fov,
      ),
    )
    .toBeGreaterThan(66)
  const result = await page.evaluate(() => {
    const { dog, camera } = window.dogSandbox as typeof window.dogSandbox & {
      camera: import("three").PerspectiveCamera
    }
    let frame = 0
    while (frame++ < 4) dog.update(0.1)
    dog.paused = true
    const action = (
      dog as unknown as { active: import("three").AnimationAction }
    ).active
    const duration = action.getClip().duration
    const root = dog.group.getObjectByName("joint_18")
    if (!root) throw new Error("Missing pelvis")
    const paws = ["joint_6", "joint_34", "joint_3", "joint_38"].map((name) => {
      const bone = dog.group.getObjectByName(name)
      if (!bone) throw new Error(`Missing ${name}`)
      return bone
    })
    const meshes: import("three").SkinnedMesh[] = []
    dog.group.traverse((object) => {
      if ("isSkinnedMesh" in object)
        meshes.push(object as import("three").SkinnedMesh)
    })
    action.time = 0
    dog.update(0)
    const start = root.matrixWorld.clone()
    const floors = paws.map((bone) => bone.matrixWorld.elements[13])
    const previous = root.quaternion.clone()
    let rotation = 0
    let largestStep = 0
    let minimumSurface = Infinity
    let maximumScreenHeight = 0
    let invertedInAir = false
    const heights: number[] = []
    const point = dog.group.position.clone()
    const count = Math.round(duration * 120)
    frame = 0
    while (frame <= count) {
      action.time = Math.min(duration, frame / 120)
      dog.update(0)
      const delta = root.quaternion.clone().multiply(previous.clone().invert())
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
      rotation += 2 * Math.atan2(delta.x, delta.w)
      largestStep = Math.max(largestStep, root.quaternion.angleTo(previous))
      previous.copy(root.quaternion)
      heights.push(root.matrixWorld.elements[13] - start.elements[13])
      if (Math.abs(rotation - Math.PI) < 0.2)
        invertedInAir ||= paws.every(
          (bone, index) => bone.matrixWorld.elements[13] - floors[index] > 0.4,
        )
      if (frame % 6 === 0) {
        for (const mesh of meshes) {
          let vertex = 0
          while (vertex < mesh.geometry.getAttribute("position").count) {
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)
            minimumSurface = Math.min(minimumSurface, point.y)
            point.project(camera)
            maximumScreenHeight = Math.max(maximumScreenHeight, point.y)
            vertex += 20
          }
        }
      }
      frame++
    }
    const end = root.matrixWorld.clone()
    dog.paused = false
    dog.update(0.1)
    return {
      rotation,
      largestStep,
      minimumSurface,
      maximumScreenHeight,
      invertedInAir,
      crouch: Math.min(...heights.slice(0, Math.round(count * 0.22))),
      peak: Math.max(...heights),
      endpointError: Math.max(
        ...end.elements.map((value, index) =>
          Math.abs(value - start.elements[index]),
        ),
      ),
      action: dog.action,
    }
  })
  console.log("BACKFLIP", JSON.stringify(result))
  expect(result.rotation).toBeCloseTo(2 * Math.PI, 2)
  expect(result.largestStep).toBeLessThan(0.15)
  expect(result.crouch).toBeLessThan(-0.08)
  expect(result.peak).toBeGreaterThan(1)
  expect(result.invertedInAir).toBe(true)
  expect(result.minimumSurface).toBeGreaterThan(-0.04)
  expect(result.maximumScreenHeight).toBeLessThan(0.98)
  expect(result.endpointError).toBeLessThan(0.001)
  expect(result.action).toBe("idle")
  await expect(page.locator("#action-status")).toHaveText("IDLE")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window.dogSandbox as typeof window.dogSandbox & {
              camera: import("three").PerspectiveCamera
            }
          ).camera.fov,
      ),
    )
    .toBeLessThan(38.02)
  expect(errors).toEqual([])
})
