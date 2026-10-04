import { expect, test } from "@playwright/test"

test("selects an uploaded model and restores the named dog with its reference photos", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  const selector = page.locator("#dog-model")
  const references = page.locator(".source-preview")
  await expect(selector).toHaveValue("huawei")
  await expect(references).toBeVisible()

  await page.locator("#model-upload").setInputFiles("work/test-rig.glb")
  await expect(page.locator("#asset-name")).toHaveText("test-rig.glb")
  await expect(page.locator("#notice")).toBeHidden()
  await expect(selector).toHaveValue("imported")
  await expect(selector.locator('option[value="imported"]')).toContainText(
    "test-rig.glb",
  )
  await expect(references).toBeHidden()
  const uploaded = await page.evaluate(() => ({
    faceMode: window.dogSandbox.dog.hasFaceAppearance,
    actions: window.dogSandbox.dog.availableActions,
  }))
  expect(uploaded.faceMode).toBe(false)
  expect(uploaded.actions).toEqual(["idle", "walk", "spin"])

  await selector.selectOption("huawei")
  await expect(page.locator("#asset-name")).toHaveText("Huawei's dog")
  await expect(page.locator("#notice")).toBeHidden()
  await expect(selector).toHaveValue("huawei")
  await expect(selector.locator('option[value="imported"]')).toHaveCount(0)
  await expect(references).toBeVisible()
  await expect(page.locator("#source-original")).toHaveAttribute(
    "src",
    "/models/huawei-dog-reference.png",
  )
  await expect(page.locator("#source-standing")).toHaveAttribute(
    "src",
    "/models/huawei-dog-fullbody.png",
  )
  await page.locator("#source-title").click()
  await expect(page.locator("#source-original")).toBeVisible()
  await expect(page.locator("#source-standing")).toBeVisible()
  expect(
    await page.evaluate(() => window.dogSandbox.dog.availableActions.length),
  ).toBe(13)
})
