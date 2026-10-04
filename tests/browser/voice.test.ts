import { expect, type Page, test } from "@playwright/test"
import { DOG_ACTIONS } from "../../src/dog"
import { rigWithActions } from "./sandbox"

/**
 * Drives the transcript path directly. The microphone and the ElevenLabs
 * socket are deliberately out of scope here: this covers the part that turns
 * heard words into dog behaviour, which is where the logic lives.
 */
async function hold(page: Page, lines: [string, boolean][]): Promise<void> {
  await page.evaluate(() => {
    window.dogSandbox.voice.hold()
  })
  for (const [text, settled] of lines)
    await page.evaluate(
      ([spoken, final]) => {
        window.dogSandbox.voice.transcript(spoken as string, final as boolean)
      },
      [text, settled],
    )
}

async function routeRig(page: Page, clips = DOG_ACTIONS.map((a) => a.name)) {
  await page.route("**/models/dog-animated.glb", (route) =>
    route.fulfill({
      body: rigWithActions(clips),
      contentType: "model/gltf-binary",
    }),
  )
}

test("turns spoken keywords into dog actions without a second pass", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await routeRig(page)
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()

  await expect(page.locator("#talk")).toBeVisible()
  await expect(page.locator("#speech-bubble")).toBeHidden()

  // A partial fires straight away, and the matching commit must not repeat it.
  await hold(page, [
    ["si", false],
    ["sit", false],
  ])
  await expect(page.locator("#action-status")).toHaveText("SIT")
  await expect(page.locator("#speech-text")).toHaveText("sit")
  await expect(
    page.getByRole("button", { name: "Sit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await hold(page, [["sit", true]])
  await expect(page.locator("#action-status")).toHaveText("SIT")

  // Synonyms, filler words, and inflections all land on the same clip.
  for (const [spoken, label] of [
    ["um, okay, spin around please", "SPIN"],
    ["good boy", "WAG"],
    ["speak", "BARK"],
    ["sitting", "SIT"],
    ["stand up", "IDLE"],
  ] as const) {
    await hold(page, [[spoken, true]])
    await expect(page.locator("#action-status")).toHaveText(label)
  }

  // A correction in the committed transcript replaces what a partial fired.
  await hold(page, [
    ["sit", false],
    ["jump", true],
  ])
  await expect(page.locator("#action-status")).toHaveText("JUMP")
  expect(errors).toEqual([])
})

test("sends the dog after the ball and brings it home on command", async ({
  page,
}) => {
  await routeRig(page)
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()

  await hold(page, [["go fetch", true]])
  await expect(page.locator("#fetch-status")).toHaveText("FETCHING THE BALL")
  await expect
    .poll(() => page.evaluate(() => window.dogSandbox.fetchPlay.state))
    .toBe("chasing")

  await hold(page, [["come here", true]])
  expect(await page.evaluate(() => window.dogSandbox.fetchPlay.state)).toBe(
    "idle",
  )
  expect(
    await page.evaluate(() => window.dogSandbox.dog.group.position.length()),
  ).toBeLessThan(0.01)
  await expect(page.locator("#action-status")).toHaveText("IDLE")
})

test("explains a miss instead of leaving the dog silent", async ({ page }) => {
  await routeRig(page, ["idle", "walk", "sit"])
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden()

  await hold(page, [["what a lovely afternoon", true]])
  await expect(page.locator("#speech-note")).toHaveText(
    "That is not a keyword yet.",
  )
  await expect(page.locator("#action-status")).toHaveText("IDLE")

  await hold(page, [["", true]])
  await expect(page.locator("#speech-note")).toHaveText(
    "I didn't hear anything.",
  )

  // The keyword is known, but this rig has no clip for it.
  await hold(page, [["spin around", true]])
  await expect(page.locator("#speech-note")).toHaveText(
    "This dog has no spin clip.",
  )
  await expect(page.locator("#action-status")).toHaveText("IDLE")

  await hold(page, [["sit", true]])
  await expect(page.locator("#action-status")).toHaveText("SIT")
  await expect(page.locator("#speech-note")).toHaveText("")
})

test("mints realtime tokens from the server, never the browser", async ({
  page,
}) => {
  await routeRig(page)
  await page.goto("/")
  const wrongMethod = await page.request.get("/api/scribe-token")
  expect(wrongMethod.status()).toBe(405)
  // The key must never reach the client bundle.
  const bundle = await (await page.request.get("/src/voice/scribe.ts")).text()
  expect(bundle).not.toContain("xi-api-key")
  expect(bundle).toContain("/api/scribe-token")
})
