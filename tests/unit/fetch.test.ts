import * as THREE from "three"
import { describe, expect, it } from "vitest"
import type { Dog, DogAction } from "../../src/dog"
import { FetchInteraction } from "../../src/fetch"

function fixture() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const viewport = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    }),
  }) as unknown as HTMLElement
  const dog = {
    group: new THREE.Group(),
    sampleCount: 50000,
    paused: false,
    speed: 1,
    action: "idle" as DogAction,
    availableActions: ["idle", "walk", "spin"],
    playAction(action: DogAction) {
      this.action = action
    },
  } as Dog
  const fetch = new FetchInteraction(dog, scene, camera, viewport)
  return { dog, fetch, scene }
}

describe("fetch interaction", () => {
  it("throws, chases, returns with the ball, and resumes idle", () => {
    const { dog, fetch } = fixture()
    expect(fetch.throwTo(new THREE.Vector3(2, 0, -1.5))).toBe(true)
    expect(fetch.ball.visible).toBe(true)
    expect(fetch.state).toBe("throwing")
    for (let frame = 0; frame < 220 && fetch.state !== "idle"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("idle")
    expect(dog.action).toBe("idle")
    expect(dog.group.position.length()).toBeLessThan(0.1)
    expect(fetch.ball.visible).toBe(true)
    expect(fetch.ball.position.distanceTo(dog.group.position)).toBeLessThan(1)
    fetch.dispose()
  })

  it("ignores movement while paused and resets a repeated throw", () => {
    const { dog, fetch, scene } = fixture()
    fetch.throwTo(new THREE.Vector3(2, 0, 0))
    dog.paused = true
    fetch.update(1)
    expect(fetch.state).toBe("throwing")
    dog.paused = false
    for (let frame = 0; frame < 15; frame++) fetch.update(1 / 30)
    fetch.throwTo(new THREE.Vector3(-2, 0, 0))
    expect(fetch.state).toBe("throwing")
    expect(scene.children).toContain(fetch.ball)
    fetch.reset()
    expect(fetch.state).toBe("idle")
    expect(fetch.ball.visible).toBe(false)
    expect(dog.action).toBe("idle")
    expect(dog.group.position.length()).toBe(0)
    fetch.dispose()
    expect(scene.children).not.toContain(fetch.ball)
  })

  it("does not start without a dog", () => {
    const { dog, fetch } = fixture()
    dog.sampleCount = 0
    expect(fetch.throwTo(new THREE.Vector3(1, 0, 1))).toBe(false)
    expect(fetch.ball.visible).toBe(false)
    fetch.dispose()
  })

  it("does not start without a walking clip", () => {
    const { dog, fetch } = fixture()
    dog.availableActions.splice(0, dog.availableActions.length, "idle")
    expect(fetch.throwTo(new THREE.Vector3(1, 0, 1))).toBe(false)
    expect(fetch.state).toBe("idle")
    expect(fetch.ball.visible).toBe(false)
    fetch.dispose()
  })

  it("runs to distant throws and walks to nearby ones when both clips exist", () => {
    const { dog, fetch } = fixture()
    dog.availableActions.push("run")
    fetch.throwTo(new THREE.Vector3(2, 0, 0))
    for (let frame = 0; frame < 18; frame++) fetch.update(1 / 30)
    expect(dog.action).toBe("run")
    fetch.reset()
    fetch.throwTo(new THREE.Vector3(1, 0, 0))
    for (let frame = 0; frame < 18; frame++) fetch.update(1 / 30)
    expect(dog.action).toBe("walk")
    fetch.dispose()
  })
})
