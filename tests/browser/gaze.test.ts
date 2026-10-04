import { expect, test } from "@playwright/test"

test("action clips keep the corrected neutral head pose", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const heads: number[][] = []
  for (const name of [
    "idle",
    "walk",
    "run",
    "jump",
    "sit",
    "bark",
    "paw",
    "spin",
    "playbow",
    "wag",
  ]) {
    await page.locator(`[data-action="${name}"]`).click()
    await page.mouse.move(10, 10)
    heads.push(
      await page.evaluate(() => {
        const dog = window.dogSandbox.dog
        dog.lookToward(0)
        let frame = 0
        while (frame++ < 5) dog.update(0.1)
        const action = (
          dog as unknown as { active: import("three").AnimationAction }
        ).active
        action.time = 0
        dog.update(0)
        dog.paused = true
        const head = dog.group.getObjectByName("joint_14")
        if (!head) throw new Error("Missing head rig")
        return head.getWorldQuaternion(head.quaternion.clone()).toArray()
      }),
    )
  }
  const neutral = heads[0]
  for (const head of heads.slice(1)) {
    const dot = head.reduce(
      (sum, value, index) => sum + value * neutral[index],
      0,
    )
    expect(2 * Math.acos(Math.min(1, Math.abs(dot)))).toBeLessThan(0.15)
  }
})

test("the idle dog follows the cursor with its head and recenters on leave", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await page.evaluate(() => {
    const dog = window.dogSandbox.dog
    const action = (
      dog as unknown as { active: import("three").AnimationAction }
    ).active
    action.paused = true
    action.time = 0
    dog.update(0)
  })
  const box = await page.locator("#viewport").boundingBox()
  if (!box) throw new Error("Missing playground")
  const pose = () =>
    page.evaluate(() => {
      const dog = window.dogSandbox.dog
      const neck = dog.group.getObjectByName("joint_22")
      const head = dog.group.getObjectByName("joint_14")
      const jaw = dog.group.getObjectByName("joint_21")
      if (!neck || !head || !jaw) throw new Error("Missing head rig")
      return {
        neck: neck.quaternion.toArray(),
        body: dog.group.rotation.y,
        position: dog.group.position.toArray(),
        look: (dog as unknown as { lookAngle: number }).lookAngle,
        jawInHead: head
          .worldToLocal(jaw.getWorldPosition(jaw.position.clone()))
          .toArray(),
      }
    })
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.45)
  await expect.poll(async () => (await pose()).look).toBeLessThan(-0.3)
  const left = await pose()
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.45)
  await expect.poll(async () => (await pose()).look).toBeGreaterThan(0.3)
  const right = await pose()
  expect(right.body).toBe(left.body)
  expect(right.position).toEqual(left.position)
  expect(Math.abs(right.neck[1] - left.neck[1])).toBeGreaterThan(0.2)
  expect(
    Math.hypot(
      ...right.jawInHead.map((value, index) => value - left.jawInHead[index]),
    ),
  ).toBeLessThan(0.00001)
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  const paused = await pose()
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.45)
  await page.waitForTimeout(250)
  expect((await pose()).neck).toEqual(paused.neck)
  await page.getByRole("button", { name: "Resume", exact: true }).click()
  await page.mouse.move(10, 10)
  await expect
    .poll(async () => Math.abs((await pose()).look))
    .toBeLessThan(0.01)
})
