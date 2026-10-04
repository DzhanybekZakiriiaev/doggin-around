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
  const played: DogAction[] = []
  let actionRate = 1
  const dog = {
    group: new THREE.Group(),
    sampleCount: 50000,
    paused: false,
    speed: 1,
    get actionRate() {
      return actionRate
    },
    action: "idle" as DogAction,
    availableActions: ["idle", "walk", "spin"],
    setActionRate(rate: number) {
      actionRate = rate
    },
    lookToward() {},
    playAction(this: { action: DogAction }, action: DogAction) {
      this.action = action
      played.push(action)
    },
  } as unknown as Dog
  const fetch = new FetchInteraction(dog, scene, camera, viewport)
  return { dog, fetch, scene, played }
}

describe("fetch interaction", () => {
  it("throws, chases, returns with the ball, and resumes idle", () => {
    const { dog, fetch } = fixture()
    expect(fetch.throwTo(new THREE.Vector3(2, 0, -1.5))).toBe(true)
    expect(fetch.ball.visible).toBe(true)
    expect(fetch.state).toBe("throwing")
    for (let frame = 0; frame < 450 && fetch.state !== "idle"; frame++)
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
    fetch.throwTo(new THREE.Vector3(0, 0, -2.6))
    for (let frame = 0; frame < 18; frame++) fetch.update(1 / 30)
    expect(dog.action).toBe("walk")
    expect(dog.actionRate).toBeGreaterThan(0)
    for (let frame = 0; frame < 20; frame++) fetch.update(1 / 30)
    expect(dog.action).toBe("run")
    fetch.reset()
    expect(dog.actionRate).toBe(1)
    fetch.throwTo(new THREE.Vector3(1, 0, 0))
    for (let frame = 0; frame < 18; frame++) fetch.update(1 / 30)
    expect(dog.action).toBe("walk")
    expect(dog.actionRate).toBeGreaterThan(0)
    expect(dog.actionRate).toBeLessThan(0.6)
    fetch.dispose()
  })

  it("walks into pickup and turns before traveling home", () => {
    const { dog, fetch, played } = fixture()
    dog.availableActions.push("run")
    dog.speed = 1.5
    fetch.throwTo(new THREE.Vector3(0, 0, -2))
    for (let frame = 0; frame < 120 && fetch.state !== "returning"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("returning")
    expect(dog.action).toBe("walk")
    expect(dog.actionRate).toBeGreaterThan(0)
    expect(dog.actionRate).toBeLessThan(2.1 / 4.7)
    expect(dog.speed).toBe(1.5)
    expect(played.filter((action) => action === "run")).toHaveLength(1)
    const pickup = dog.group.position.clone()
    fetch.update(1 / 30)
    expect(dog.group.position.distanceTo(pickup)).toBeLessThan(0.001)
    for (let frame = 0; frame < 120 && fetch.state !== "idle"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("idle")
    expect(dog.actionRate).toBe(1)
    fetch.dispose()
  })

  it("lowers the head for pickup before carrying the ball from the muzzle", () => {
    const { dog, fetch, played } = fixture()
    dog.availableActions.push("run", "sniff")
    const jaw = new THREE.Bone()
    jaw.name = "joint_21"
    jaw.position.set(0, 1.2, -0.4)
    const mouth = new THREE.Bone()
    mouth.name = "joint_20"
    mouth.position.set(0, -0.1, -0.2)
    jaw.add(mouth)
    dog.group.add(jaw)

    fetch.throwTo(new THREE.Vector3(0, 0, -2))
    for (let frame = 0; frame < 120 && fetch.state !== "picking-up"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("picking-up")
    expect(dog.action).toBe("sniff")
    expect(fetch.ball.position.y).toBeCloseTo(0.12)
    const pickup = dog.group.position.clone()
    expect(pickup.z).toBeCloseTo(-1.58)

    for (let frame = 0; frame < 21; frame++) fetch.update(1 / 30)
    expect(fetch.state).toBe("picking-up")
    expect(dog.group.position.distanceTo(pickup)).toBeLessThan(0.001)
    expect(fetch.ball.position.y).toBeCloseTo(0.12)

    for (let frame = 0; frame < 30 && fetch.state !== "returning"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("returning")
    expect(dog.action).toBe("walk")
    expect(played.slice(-2)).toEqual(["sniff", "walk"])
    expect(
      fetch.ball.position.distanceTo(
        mouth.localToWorld(new THREE.Vector3(0, -0.04, -0.1)),
      ),
    ).toBeLessThan(0.001)

    fetch.reset()
    expect(fetch.state).toBe("idle")
    expect(fetch.ball.visible).toBe(false)
    fetch.dispose()
  })

  it("cancels pickup cleanly when the ball is thrown again", () => {
    const { dog, fetch } = fixture()
    dog.availableActions.push("sniff")
    fetch.throwTo(new THREE.Vector3(0, 0, -2))
    for (let frame = 0; frame < 120 && fetch.state !== "picking-up"; frame++)
      fetch.update(1 / 30)
    expect(fetch.state).toBe("picking-up")
    expect(dog.action).toBe("sniff")

    expect(fetch.throwTo(new THREE.Vector3(1, 0, -1))).toBe(true)
    expect(fetch.state).toBe("throwing")
    expect(fetch.ball.visible).toBe(true)
    fetch.reset()
    expect(fetch.state).toBe("idle")
    expect(dog.action).toBe("idle")
    expect(fetch.ball.visible).toBe(false)
    expect(dog.group.position.length()).toBe(0)
    fetch.dispose()
  })
})
