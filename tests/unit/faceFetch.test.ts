import * as THREE from "three"
import { describe, expect, it } from "vitest"
import type { Dog, DogAction } from "../../src/dog"
import { FetchInteraction } from "../../src/fetch"

function fixture() {
  const jaw = new THREE.Vector3(0.31, 0.12, -0.93)
  const samples: { action: DogAction; time: number }[] = []
  const dog = {
    group: new THREE.Group(),
    sampleCount: 50000,
    hasFaceAppearance: true,
    paused: false,
    speed: 1,
    action: "idle" as DogAction,
    availableActions: ["idle", "walk", "sniff"],
    setActionRate() {},
    lookToward() {},
    playAction(this: { action: DogAction }, action: DogAction) {
      this.action = action
    },
    sampleActionMouthOffset(
      action: DogAction,
      time: number,
      target: THREE.Vector3,
    ) {
      samples.push({ action, time })
      return target.copy(jaw)
    },
    getMouthWorldPosition(this: { group: THREE.Group }, target: THREE.Vector3) {
      return this.group.localToWorld(target.copy(jaw))
    },
  } as unknown as Dog
  const viewport = new EventTarget() as unknown as HTMLElement
  const fetch = new FetchInteraction(
    dog,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    viewport,
  )
  return { dog, fetch, jaw, samples }
}

describe("baked mouth pickup placement", () => {
  it.each([
    [2, -1],
    [-1.4, -1.6],
    [0, 2.2],
    [-2, 0],
  ])(
    "places the lateral jaw over a toss at (%s, %s) after smoothly settling its heading",
    (x, z) => {
      const { dog, fetch, jaw, samples } = fixture()
      dog.group.rotation.y = 2.6
      const target = new THREE.Vector3(x, 0, z)
      expect(fetch.throwTo(target)).toBe(true)
      expect(samples).toEqual([{ action: "sniff", time: 0.85 }])
      expect(dog.action).toBe("idle")
      const heading = Math.atan2(-x, -z)
      const expected = target.clone().sub(
        jaw
          .clone()
          .setY(0)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), heading),
      )
      let settlingFrames = 0
      let previousYaw = dog.group.rotation.y
      for (
        let frame = 0;
        frame < 1500 && fetch.state !== "picking-up";
        frame++
      ) {
        fetch.update(1 / 60)
        const yawStep = Math.atan2(
          Math.sin(dog.group.rotation.y - previousYaw),
          Math.cos(dog.group.rotation.y - previousYaw),
        )
        expect(Math.abs(yawStep)).toBeLessThanOrEqual(3.8 / 60 + 1e-10)
        previousYaw = dog.group.rotation.y
        if (
          fetch.state === "chasing" &&
          dog.group.position.distanceTo(expected) < 0.001
        )
          settlingFrames++
      }
      expect(fetch.state).toBe("picking-up")
      expect(settlingFrames).toBeGreaterThan(0)
      expect(dog.group.position.distanceTo(expected)).toBeLessThan(1e-7)
      const difference = Math.atan2(
        Math.sin(heading - dog.group.rotation.y),
        Math.cos(heading - dog.group.rotation.y),
      )
      expect(Math.abs(difference)).toBeLessThan(0.006)
      const mouth = dog.getMouthWorldPosition(new THREE.Vector3())
      expect(Math.hypot(mouth.x - x, mouth.z - z)).toBeLessThan(0.006)
      expect(fetch.ball.position.y).toBeCloseTo(0.12)
      const stopped = dog.group.position.clone()
      dog.paused = true
      fetch.update(0.1)
      expect(fetch.state).toBe("picking-up")
      expect(dog.group.position.equals(stopped)).toBe(true)
      dog.paused = false
      fetch.reset()
      expect(fetch.state).toBe("idle")
      expect(fetch.ball.visible).toBe(false)
      fetch.dispose()
    },
  )
})
