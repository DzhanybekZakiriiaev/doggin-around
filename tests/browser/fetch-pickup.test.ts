import { expect, test } from "@playwright/test"

test("the dog lowers its muzzle, picks up the ball, and carries it from its mouth", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const restingHeight = await page.evaluate(() => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const tip = dog.group.getObjectByName("joint_20")
    if (!tip) throw new Error("The default dog has no muzzle tip")
    dog.playAction("idle")
    for (let frame = 0; frame < 5; frame++) dog.update(0.1)
    return tip.localToWorld(fetchPlay.ball.position.clone().set(0, -0.04, -0.1))
      .y
  })
  await page.getByRole("button", { name: "Toss the ball" }).click()
  const pose = await page.evaluate((restingHeight) => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const tip = dog.group.getObjectByName("joint_20")
    if (!tip) throw new Error("The default dog has no muzzle tip")
    const atMouth = () =>
      tip.localToWorld(fetchPlay.ball.position.clone().set(0, -0.04, -0.1))
    for (
      let frame = 0;
      frame < 250 && fetchPlay.state !== "picking-up";
      frame++
    ) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
    }
    if (fetchPlay.state !== "picking-up")
      throw new Error("The dog did not reach the pickup stage")
    for (let frame = 0; frame < 36; frame++) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
    }
    dog.paused = true
    return {
      state: fetchPlay.state,
      action: dog.action,
      restingHeight,
      muzzleHeight: atMouth().y,
      ballHeight: fetchPlay.ball.position.y,
      gap: atMouth().distanceTo(fetchPlay.ball.position),
      mouth: atMouth().toArray(),
      ball: fetchPlay.ball.position.toArray(),
    }
  }, restingHeight)
  console.log("PICKUP_POSE", JSON.stringify(pose))
  await page.screenshot({ path: "work/fetch-pickup-posed.png" })
  expect(pose.state).toBe("picking-up")
  expect(pose.action).toBe("sniff")
  expect(pose.ballHeight).toBeCloseTo(0.12)
  expect(pose.restingHeight - pose.muzzleHeight).toBeGreaterThan(0.5)
  expect(pose.gap).toBeLessThan(0.25)
  expect(
    Math.hypot(pose.mouth[0] - pose.ball[0], pose.mouth[2] - pose.ball[2]),
  ).toBeLessThan(0.05)
  await expect(page.locator("#fetch-status")).toHaveText("PICKING IT UP")

  const carrying = await page.evaluate(() => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    const tip = dog.group.getObjectByName("joint_20")
    if (!tip) throw new Error("The default dog has no muzzle tip")
    dog.paused = false
    let maxBallStep = 0
    const previousBall = fetchPlay.ball.position.clone()
    for (
      let frame = 0;
      frame < 60 && fetchPlay.state !== "returning";
      frame++
    ) {
      fetchPlay.update(1 / 60)
      dog.update(1 / 60)
      maxBallStep = Math.max(
        maxBallStep,
        fetchPlay.ball.position.distanceTo(previousBall),
      )
      previousBall.copy(fetchPlay.ball.position)
    }
    fetchPlay.update(0)
    dog.paused = true
    return {
      state: fetchPlay.state,
      action: dog.action,
      maxBallStep,
      gap: fetchPlay.ball.position.distanceTo(
        tip.localToWorld(fetchPlay.ball.position.clone().set(0, -0.04, -0.1)),
      ),
    }
  })
  expect(carrying.state).toBe("returning")
  expect(carrying.action).toBe("run")
  expect(carrying.maxBallStep).toBeLessThan(0.08)
  expect(carrying.gap).toBeLessThan(0.01)
  await page.evaluate(() => {
    const { dog, fetchPlay } = window.dogSandbox as typeof window.dogSandbox & {
      fetchPlay: import("../../src/fetch").FetchInteraction
    }
    dog.paused = false
    fetchPlay.reset()
  })
  await expect(page.locator("#fetch-status")).toHaveText(
    "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT",
  )
})
