import { expect, test } from "@playwright/test"

for (const candidate of [
  {
    name: "example",
    asset: "/models/example-dog-animated.glb",
    root: "joint_23",
    leg: "joint_1",
  },
  {
    name: "Huawei",
    asset: "/models/dog-animated.glb",
    root: "joint_18",
    leg: "joint_5",
  },
])
  test(`${candidate.name} dog retains its skin and performs a complete repeatable turn`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    await page.goto("/")
    await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
    if (candidate.name === "example") {
      await page.evaluate(
        (asset) => window.dogSandbox.loadDog(asset),
        candidate.asset,
      )
      await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
    }
    const result = await page.evaluate(
      ({ rootName, legName }) => {
        const dog = window.dogSandbox.dog
        const skins: import("three").SkinnedMesh[] = []
        dog.group.traverse((object) => {
          if ("isSkinnedMesh" in object)
            skins.push(object as import("three").SkinnedMesh)
        })
        const mesh = skins[0]
        const root = mesh.skeleton.bones.find((bone) => bone.name === rootName)
        const leg = mesh.skeleton.bones.find((bone) => bone.name === legName)
        if (!root || !leg)
          throw new Error("The generated dog is missing reviewed joints")
        dog.paused = false
        dog.playAction("spin")
        const angles: number[] = []
        const base = root.quaternion.clone()
        let previous = 0
        let total = 0
        for (let step = 0; step < 41; step++) {
          dog.update(0.1)
          const relative = base.clone().invert().multiply(root.quaternion)
          const angle = 2 * Math.atan2(relative.y, relative.w)
          let change = angle - previous
          while (change < -Math.PI) change += Math.PI * 2
          while (change > Math.PI) change -= Math.PI * 2
          total += change
          previous = angle
          angles.push(total)
        }
        const finished = dog.action
        dog.playAction("spin")
        dog.update(0.1)
        const restarted = dog.action
        dog.playAction("walk")
        const initial = leg.quaternion.clone()
        for (let step = 0; step < 4; step++) dog.update(0.1)
        const legMotion = initial.angleTo(leg.quaternion)
        dog.playAction("idle")
        return {
          bones: mesh.skeleton.bones.length,
          texture: Boolean(
            (mesh.material as import("three").MeshStandardMaterial).map,
          ),
          finished,
          restarted,
          total,
          angles,
          legMotion,
        }
      },
      { rootName: candidate.root, legName: candidate.leg },
    )
    expect(result.bones).toBe(41)
    expect(result.texture).toBe(true)
    expect(Math.abs(result.total)).toBeCloseTo(Math.PI * 2, 1)
    expect(result.finished).toBe("idle")
    expect(result.restarted).toBe("spin")
    expect(result.legMotion).toBeGreaterThan(0.05)
    expect(errors).toEqual([])
  })
