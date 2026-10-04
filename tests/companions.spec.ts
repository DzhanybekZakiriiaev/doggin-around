import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

function clipNames(path: string): string[] {
  const glb = readFileSync(path)
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
  return json.animations.map((clip: { name: string }) => clip.name)
}

async function hub(page: Page) {
  await page.goto('/')
  await page.locator('.intro-splash').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'BRING IT TO LIFE' }).click()
  await page.getByRole('button', { name: /SKIP/ }).click()
  await expect(page.getByRole('navigation', { name: 'Choose your companion' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose Wei dog' })).toBeEnabled({ timeout: 60000 })
  await page.mouse.move(1400, 900)
}

async function wheelSkills(page: Page) {
  await page.keyboard.press('x')
  const wheel = page.getByRole('dialog', { name: 'Dog skills' })
  await expect(wheel).toBeVisible()
  const count = Number((await wheel.locator('.emote-wheel__pages span').textContent())?.split('/')[1])
  const names: string[] = []
  let index = 0
  while (index++ < count) {
    names.push(...await wheel.locator('[data-skill]').evaluateAll(slots => slots.map(slot => (slot as HTMLElement).dataset.skill ?? '')))
    if (index < count) await wheel.getByRole('button', { name: 'Next skills' }).click()
  }
  return names
}

test('portraits switch the real models and X contains only each dog’s clips', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await hub(page)
  const huawei = page.getByRole('button', { name: 'Choose Hua dog' })
  const tricolor = page.getByRole('button', { name: 'Choose Wei dog' })
  await expect(huawei).toHaveAttribute('aria-pressed', 'true')
  const huaweiSkills = await wheelSkills(page)
  expect(huaweiSkills.sort()).toEqual([...clipNames('public/models/dog-animated.glb').filter(name => name !== 'peekaboo'), 'pet'].sort())
  expect(huaweiSkills).not.toContain('peekaboo')
  expect(huaweiSkills).toContain('gangnam')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/huawei-selector.png' })

  const appearance = page.waitForResponse(response => response.url().endsWith('/tricolor-research/splats.ply'))
  await page.keyboard.press('x')
  await tricolor.click()
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
  await expect(tricolor).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 })
  expect((await appearance).ok()).toBe(true)
  await expect(huawei).toHaveAttribute('aria-pressed', 'false')
  const tricolorSkills = await wheelSkills(page)
  expect(tricolorSkills.sort()).toEqual([...clipNames('public/models/tricolor-research/dog-animated.glb'), 'pet'].sort())
  expect(tricolorSkills).not.toContain('backflip')
  expect(tricolorSkills).not.toContain('gangnam')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/tricolor-selector.png' })

  await huawei.click()
  await expect(huawei).toHaveAttribute('aria-pressed', 'true')
  expect((await wheelSkills(page)).sort()).toEqual(huaweiSkills.sort())
  await page.getByRole('button', { name: 'Gangnam style', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/huawei-dance.png' })
  expect(errors).toEqual([])
})

test('a failed switch keeps the current dog and allows a retry', async ({ page }) => {
  await hub(page)
  await page.route('**/tricolor-research/manifest.json', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.getByRole('button', { name: 'Choose Wei dog' }).click()
  await expect(page.getByRole('status')).toContainText('Your current companion is still here')
  await expect(page.getByRole('button', { name: 'Choose Hua dog' })).toHaveAttribute('aria-pressed', 'true')
  expect(await wheelSkills(page)).toContain('gangnam')
  await page.keyboard.press('Escape')
  await page.unroute('**/tricolor-research/manifest.json')
  await page.getByRole('button', { name: 'Choose Wei dog' }).click()
  await expect(page.getByRole('button', { name: 'Choose Wei dog' })).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 })
  expect(await wheelSkills(page)).not.toContain('gangnam')
})

test('X ignores name editing and switching stays disabled during a load', async ({ page }) => {
  await hub(page)
  await page.getByRole('button', { name: 'Rename BISCUIT' }).click()
  await page.getByRole('textbox', { name: 'Dog name' }).fill('FOX')
  await page.getByRole('textbox', { name: 'Dog name' }).press('x')
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
  await page.getByRole('textbox', { name: 'Dog name' }).press('Enter')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/tricolor-research/manifest.json', async route => {
    await gate
    await route.continue()
  })
  await page.getByRole('button', { name: 'Choose Wei dog' }).click()
  await expect(page.getByRole('button', { name: 'Choose Hua dog' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Choose Wei dog' })).toBeDisabled()
  await page.keyboard.press('x')
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
  release()
  await expect(page.getByRole('button', { name: 'Choose Wei dog' })).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 })
  await page.keyboard.press('x')
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.emote-wheel__pages span')).toHaveText('2 / 2')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
})

test('the selected companion keeps its skills after entering the comic', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await hub(page)
  await page.getByRole('button', { name: 'Choose Wei dog' }).click()
  await expect(page.getByRole('button', { name: 'Choose Wei dog' })).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 })
  await page.getByRole('button', { name: /Step into panel 1/ }).click()
  await expect(page.locator('.game-layer--play')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.panel-portal')).toHaveCount(0, { timeout: 60000 })
  const skills = await wheelSkills(page)
  expect(skills.sort()).toEqual([...clipNames('public/models/tricolor-research/dog-animated.glb'), 'pet', 'come'].sort())
  await page.getByRole('button', { name: 'Dig', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dog skills' })).toBeHidden()
  expect(errors).toEqual([])
})
