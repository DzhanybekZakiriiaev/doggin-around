import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import type * as THREE from "three"
import type { DogAction } from "../../src/dog"
import type { FaceAppearance } from "../../src/faceAppearance"

const directory = "work/tricolor/action-regressions"
const label = process.env.TRICOLOR_ACTIONS_LABEL ?? "current"
const paws = [
  { name: "front-left", anchor: 1330, soles: [1399, 1349, 1319] },
  { name: "front-right", anchor: 3282, soles: [3352, 3261, 3324] },
  { name: "hind-left", anchor: 1521, soles: [1628, 1684, 1668] },
  { name: "hind-right", anchor: 3473, soles: [3549, 3488, 3621] },
]

test.skip(
  !existsSync("public/models/tricolor-research/manifest.json"),
  "The licensed research model is available only in the local demo",
)

test.beforeEach(async ({ page }) => {
  mkdirSync(directory, { recursive: true })
  await page.goto("/")
  await expect(page.locator("#notice")).toBeHidden({ timeout: 60000 })
  await page
    .getByLabel("Choose your dog", { exact: true })
    .selectOption("tricolor")
  await expect(page.locator("#asset-name")).toHaveText("Tricolor dog", {
    timeout: 60000,
  })
})

async function samplePaws(page: Page, name: DogAction, cycles = 1) {
  return page.evaluate(
    ({ name, cycles, paws }) => {
      const dog = window.dogSandbox.dog
      const internal = dog as unknown as {
        faceAppearance: FaceAppearance
        active: THREE.AnimationAction
      }
      const face = internal.faceAppearance
      const clip = face.clips.get(name)
      if (!clip) throw new Error(`Missing baked ${name}`)
      dog.playAction(name)
      if (dog.action !== name || internal.active.getClip().name !== name)
        throw new Error(`The ${name} sampling clock did not start`)
      dog.paused = false
      let settlingFrames = 24
      while (settlingFrames-- > 0) dog.update(1 / 60)
      dog.paused = true
      dog.group.updateWorldMatrix(true, true)
      const point = dog.group.position.clone()
      const rest = face.sample("idle", 0)
      const restHeights = paws.map(({ anchor, soles }) =>
        Math.min(
          ...[anchor, ...soles].map(
            (vertex) =>
              face.mesh.localToWorld(point.fromArray(rest, vertex * 3)).y,
          ),
        ),
      )
      const samples: {
        time: number
        phase: number
        heights: number[]
        positions: number[][]
      }[] = []
      let minimumFloor = Infinity
      let maximumHindMovement = 0
      let firstVertices: Float32Array | undefined
      let firstHindMarkers: number[][] | undefined
      let frame = 0
      while (frame <= Math.round(clip.duration * cycles * 120)) {
        const time = Math.min(clip.duration * cycles, frame / 120)
        let phase = time % clip.duration
        if (time > 0 && phase < 1e-7) phase = clip.duration
        internal.active.time = phase
        dog.update(0)
        const vertices = face.vertexPositions
        const matrix = face.mesh.matrixWorld.elements
        firstVertices ??= vertices.slice()
        const hindMarkers = paws
          .slice(2)
          .flatMap(({ anchor, soles }) =>
            [anchor, ...soles].map((vertex) =>
              face.mesh
                .localToWorld(point.fromArray(vertices, vertex * 3))
                .toArray(),
            ),
          )
        firstHindMarkers ??= hindMarkers
        const fixedHindMarkers = firstHindMarkers
        for (const [index, marker] of hindMarkers.entries())
          maximumHindMovement = Math.max(
            maximumHindMovement,
            Math.hypot(
              ...marker.map(
                (value, axis) => value - fixedHindMarkers[index][axis],
              ),
            ),
          )
        let vertex = 0
        while (vertex < vertices.length) {
          minimumFloor = Math.min(
            minimumFloor,
            matrix[1] * vertices[vertex] +
              matrix[5] * vertices[vertex + 1] +
              matrix[9] * vertices[vertex + 2] +
              matrix[13],
          )
          vertex += 3
        }
        samples.push({
          time,
          phase,
          heights: paws.map(
            ({ anchor, soles }, index) =>
              Math.min(
                ...[anchor, ...soles].map(
                  (vertex) =>
                    face.mesh.localToWorld(
                      point.fromArray(vertices, vertex * 3),
                    ).y,
                ),
              ) - restHeights[index],
          ),
          positions: paws.map(({ anchor }) =>
            face.mesh
              .localToWorld(point.fromArray(vertices, anchor * 3))
              .toArray(),
          ),
        })
        frame++
      }
      let loopClosureError = 0
      const matrix = face.mesh.matrixWorld.elements
      if (firstVertices) {
        let vertex = 0
        while (vertex < firstVertices.length) {
          const dx = face.vertexPositions[vertex] - firstVertices[vertex]
          const dy =
            face.vertexPositions[vertex + 1] - firstVertices[vertex + 1]
          const dz =
            face.vertexPositions[vertex + 2] - firstVertices[vertex + 2]
          loopClosureError = Math.max(
            loopClosureError,
            Math.hypot(
              matrix[0] * dx + matrix[4] * dy + matrix[8] * dz,
              matrix[1] * dx + matrix[5] * dy + matrix[9] * dz,
              matrix[2] * dx + matrix[6] * dy + matrix[10] * dz,
            ),
          )
          vertex += 3
        }
      }
      return {
        duration: clip.duration,
        restHeights,
        minimumFloor,
        maximumHindMovement,
        loopClosureError,
        samples,
      }
    },
    { name, cycles, paws },
  )
}

async function capturePose(page: Page, name: string, time: number) {
  await page.evaluate((time) => {
    const dog = window.dogSandbox.dog
    dog.group.rotation.y = -Math.PI / 4
    const active = (dog as unknown as { active: THREE.AnimationAction }).active
    active.time = time
    dog.update(0)
  }, time)
  await page
    .locator("#viewport")
    .screenshot({ path: `${directory}/${name}-${label}.png` })
}

test("Tricolor Jump lifts front paws first, becomes airborne, and lands front before hind", async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.getByRole("button", { name: "Jump", exact: true }).click()
  const motion = await samplePaws(page, "jump")
  const timings = paws.map((paw, index) => {
    const apex = motion.samples.reduce(
      (best, sample, frame) =>
        sample.heights[index] > motion.samples[best].heights[index]
          ? frame
          : best,
      0,
    )
    return {
      name: paw.name,
      lift: motion.samples.find((sample) => sample.heights[index] > 0.04)?.time,
      land: motion.samples
        .slice(apex)
        .find((sample) => sample.heights[index] < 0.04)?.time,
      maximumHeight: motion.samples[apex].heights[index],
    }
  })
  writeFileSync(
    `${directory}/jump-${label}.json`,
    `${JSON.stringify({ ...motion, timings, paws }, null, 2)}\n`,
  )
  for (const [name, phase] of [
    ["jump-front-lift", 0.24],
    ["jump-airborne", 0.5],
    ["jump-front-land", 0.75],
  ] as const)
    await capturePose(page, name, motion.duration * phase)
  console.log("TRICOLOR_JUMP_CONTACTS", JSON.stringify(timings))
  for (const timing of timings) {
    expect(timing.lift, timing.name).toBeDefined()
    expect(timing.land, timing.name).toBeDefined()
  }
  const frontLift = Math.max(
    timings[0].lift ?? Infinity,
    timings[1].lift ?? Infinity,
  )
  const hindLift = Math.min(
    timings[2].lift ?? -Infinity,
    timings[3].lift ?? -Infinity,
  )
  const frontLand = Math.max(
    timings[0].land ?? Infinity,
    timings[1].land ?? Infinity,
  )
  const hindLand = Math.min(
    timings[2].land ?? -Infinity,
    timings[3].land ?? -Infinity,
  )
  expect(hindLift - frontLift).toBeGreaterThan(0.18)
  expect(hindLand - frontLand).toBeGreaterThan(0.18)
  expect(
    motion.samples.some(({ heights }) =>
      heights.every((height) => height > 0.12),
    ),
  ).toBe(true)
  expect(motion.minimumFloor).toBeGreaterThan(-0.013)
  for (const height of motion.samples.at(-1)?.heights ?? [])
    expect(Math.abs(height)).toBeLessThan(0.02)
})

test("Tricolor exposes Dig for alternating grounded paw scrapes", async ({
  page,
}) => {
  test.setTimeout(120000)
  const available = await page.evaluate(
    () => window.dogSandbox.dog.availableActions,
  )
  const digVisible = await page.locator('[data-action="dig"]').isVisible()
  writeFileSync(
    `${directory}/dig-${label}.json`,
    `${JSON.stringify({ available, digVisible }, null, 2)}\n`,
  )
  await page.screenshot({ path: `${directory}/dig-control-${label}.png` })
  expect(available).toContain("dig")
  expect(digVisible).toBe(true)
  await page.getByRole("button", { name: "Dig", exact: true }).click()
  const motion = await samplePaws(page, "dig", 2)
  const armed = [true, true]
  const liftEvents: {
    name: string
    time: number
  }[] = []
  const groundedScrapes = [0, 0]
  const liftedReturns = [0, 0]
  for (const [frame, sample] of motion.samples.entries()) {
    for (const paw of [0, 1]) {
      if (sample.heights[paw] <= 0.025) armed[paw] = true
      if (armed[paw] && sample.heights[paw] > 0.06) {
        liftEvents.push({ name: paws[paw].name, time: sample.time })
        armed[paw] = false
      }
      if (frame === 0) continue
      const previous = motion.samples[frame - 1]
      const dz = sample.positions[paw][2] - previous.positions[paw][2]
      if (sample.heights[paw] < 0.025 && previous.heights[paw] < 0.025)
        groundedScrapes[paw] += Math.max(dz, 0)
      if (sample.heights[paw] > 0.04 && previous.heights[paw] > 0.04)
        liftedReturns[paw] += Math.max(-dz, 0)
    }
  }
  const frontMotion = [0, 1].map((paw) => {
    const heights = motion.samples.map((sample) => sample.heights[paw])
    const travel = motion.samples.map((sample) => sample.positions[paw][2])
    const apex = motion.samples.reduce(
      (best, sample, frame) =>
        sample.heights[paw] > motion.samples[best].heights[paw] ? frame : best,
      0,
    )
    return {
      name: paws[paw].name,
      heightRange: Math.max(...heights) - Math.min(...heights),
      forwardTravel: Math.max(...travel) - Math.min(...travel),
      groundedScrape: groundedScrapes[paw],
      liftedReturn: liftedReturns[paw],
      apexTime: motion.samples[apex].phase,
    }
  })
  const simultaneousLift = Math.max(
    ...motion.samples.map(({ heights }) => Math.min(heights[0], heights[1])),
  )
  const result = { ...motion, paws, frontMotion, liftEvents, simultaneousLift }
  writeFileSync(
    `${directory}/dig-${label}.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  )
  await capturePose(page, "dig-front-left-return", frontMotion[0].apexTime)
  await capturePose(page, "dig-front-right-return", frontMotion[1].apexTime)
  const scrape = motion.samples.find(
    (sample, frame) =>
      frame > 0 &&
      sample.heights[0] < 0.025 &&
      sample.positions[0][2] >
        motion.samples[frame - 1].positions[0][2] + 0.001,
  )
  if (scrape) await capturePose(page, "dig-grounded-scrape", scrape.phase)
  console.log(
    "TRICOLOR_DIG_CONTACTS",
    JSON.stringify({
      frontMotion,
      liftEvents,
      simultaneousLift,
      maximumHindMovement: motion.maximumHindMovement,
      loopClosureError: motion.loopClosureError,
    }),
  )
  for (const paw of frontMotion) {
    expect(paw.heightRange, paw.name).toBeGreaterThan(0.08)
    expect(paw.forwardTravel, paw.name).toBeGreaterThan(0.12)
    expect(paw.groundedScrape, paw.name).toBeGreaterThan(0.1)
    expect(paw.liftedReturn, paw.name).toBeGreaterThan(0.1)
  }
  expect(liftEvents.length).toBeGreaterThanOrEqual(6)
  for (const [index, event] of liftEvents.entries())
    if (index > 0) expect(event.name).not.toBe(liftEvents[index - 1].name)
  expect(simultaneousLift).toBeLessThan(0.035)
  expect(motion.maximumHindMovement).toBeLessThan(0.02)
  expect(motion.minimumFloor).toBeGreaterThan(-0.013)
  expect(motion.loopClosureError).toBeLessThan(0.002)
  await page.evaluate((duration) => {
    const dog = window.dogSandbox.dog
    dog.paused = false
    let frames = Math.ceil(duration * 3 * 60)
    while (frames-- > 0) dog.update(1 / 60)
    dog.paused = true
  }, motion.duration)
  await expect(page.locator("#action-status")).toHaveText("DIG")
  await page.getByRole("button", { name: "Idle", exact: true }).click()
  await expect(page.locator("#action-status")).toHaveText("IDLE")
})
