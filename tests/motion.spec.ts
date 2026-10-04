import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { Biscuit } from '../src/game/biscuit'
import { Dog } from '../src/game/dog/dog'

function controller() {
  const dog = {
    action: 'idle', actionRate: 1, group: { scale: { z: 1 } },
    setActionRate(rate: number) { this.actionRate = rate },
    playAction(action: string) { this.action = action },
  }
  return Object.assign(Object.create(Biscuit.prototype), {
    group: new THREE.Group(), direction: new THREE.Vector3(), travelSpeed: 0,
    dog, mode: 'follow', waitTime: 0, idleTime: 0, wagTime: 0,
    walkingGait: undefined,
  })
}

test('following accelerates, brakes before arrival, and settles into idle', () => {
  const dog = controller()
  const target = new THREE.Vector3(0, 0, -3)
  dog.moveToward(target, 'walk', 1 / 60, 1.5)
  expect(dog.travelSpeed).toBeGreaterThan(0)
  expect(dog.travelSpeed).toBeLessThan(0.2)
  let peak = 0
  for (let frame = 0; frame < 360; frame++) {
    dog.follow(1 / 60, target)
    peak = Math.max(peak, dog.travelSpeed)
  }
  expect(peak).toBeGreaterThan(0.7)
  expect(dog.group.position.distanceTo(target)).toBeGreaterThanOrEqual(1.5)
  expect(dog.group.position.distanceTo(target)).toBeLessThan(1.56)
  expect(dog.travelSpeed).toBe(0)
  expect(dog.dog.action).toBe('idle')
  expect(dog.walkingGait).toBeUndefined()
})

test('movement and ground smoothing remain consistent at 30 and 60 FPS', () => {
  const simulate = (fps: number) => {
    const dog = controller()
    dog.groundAt = () => 0.25
    for (let frame = 0; frame < fps * 2; frame++) {
      dog.moveToward(new THREE.Vector3(0, 0, -20), 'walk', 1 / fps, 1.5)
      dog.snapToGround(false, 1 / fps)
    }
    return dog.group.position
  }
  expect(simulate(30).distanceTo(simulate(60))).toBeLessThan(0.02)
})

test('turning eases into the target without overshooting', () => {
  const dog = controller()
  const changes: number[] = []
  for (let frame = 0; frame < 120; frame++) {
    const previous = dog.group.rotation.y
    dog.turnTo(Math.PI / 2, 1 / 60)
    changes.push(dog.group.rotation.y - previous)
    expect(dog.group.rotation.y).toBeLessThanOrEqual(Math.PI / 2)
  }
  expect(changes.at(-1)).toBeLessThan(changes[0] / 100)
  expect(dog.group.rotation.y).toBeCloseTo(Math.PI / 2, 4)
})

test('Wei keeps the outgoing stride moving and preserves phase across gait changes', () => {
  const dog = new Dog() as any
  const root = new THREE.Group()
  dog.root = root
  dog.mixer = new THREE.AnimationMixer(root)
  const walk = new THREE.AnimationClip('walk', 2, [new THREE.VectorKeyframeTrack('.position', [0, 2], [0, 0, 0, 0, 0, 0])])
  const run = new THREE.AnimationClip('run', 1, [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 0])])
  dog.actions.set('walk', dog.mixer.clipAction(walk))
  dog.actions.set('run', dog.mixer.clipAction(run))
  const sampled: { name: string, time: number }[] = []
  dog.faceAppearance = {
    vertexPositions: new Float32Array(3),
    sample(name: string, time: number, target = new Float32Array(3)) {
      sampled.push({ name, time })
      target[0] = time
      return target
    },
    updatePositions() {},
  }
  dog.playAction('walk')
  dog.active.time = 0.8
  dog.playAction('run')
  expect(dog.active.time).toBeCloseTo(0.4)
  dog.update(0.05)
  expect(sampled.find(pose => pose.name === 'walk')?.time).toBeGreaterThan(0.8)
  expect(sampled.find(pose => pose.name === 'run')?.time).toBeGreaterThan(0.4)
  expect(dog.transitionIsPose).toBe(false)
  dog.update(0.1)
  dog.update(0.1)
  dog.update(0.1)
  expect(dog.transition).toBeUndefined()
  dog.playAction('walk')
  dog.update(0.05)
  const beforeInterrupt = dog.faceBasePositions.slice()
  dog.playAction('run')
  dog.update(0)
  expect(Array.from(dog.faceBasePositions)).toEqual(Array.from(beforeInterrupt))
})

test('Hua paws keep continuous velocity at lift-off and touchdown', async () => {
  const { pawCycle } = await import('../src/game/dog-gait')
  const h = 1e-5
  for (const duty of [0.42, 0.52, 0.62]) {
    for (const boundary of [0, duty, 1]) {
      const before = pawCycle(boundary - h, duty)
      const at = pawCycle(boundary, duty)
      const after = pawCycle(boundary + h, duty)
      for (const axis of ['along', 'lift'] as const) {
        expect(Math.abs((at[axis] - before[axis]) / h - (after[axis] - at[axis]) / h)).toBeLessThan(0.002)
      }
    }
    for (let phase = 0; phase < duty; phase += 0.01) {
      expect(pawCycle(phase, duty).lift).toBe(0)
      expect(pawCycle(phase, duty).along).toBeCloseTo(phase / duty - 0.5, 8)
    }
  }
})

test('Wei gait interpolation keeps loop velocity continuous without contact overshoot', async () => {
  const { sampleBakedClip } = await import('../src/game/dog/faceDeformation')
  const values = [0, 0.4, 1, 0.5, 0, -0.5, -1, -0.4, 0]
  const times = Float32Array.from(values, (_, index) => index / 8)
  const clip = { name: 'walk', duration: 1, times, positions: Float32Array.from(values) }
  const result = new Float32Array(1)
  const sample = (time: number) => sampleBakedClip(clip, ((time % 1) + 1) % 1, result)[0]
  const h = 0.0001
  for (const time of times) {
    const incoming = (sample(time) - sample(time - h)) / h
    const outgoing = (sample(time + h) - sample(time)) / h
    expect(Math.abs(incoming - outgoing)).toBeLessThan(0.03)
  }
  for (let segment = 0; segment < values.length - 1; segment++) {
    for (let step = 0; step <= 20; step++) {
      const value = sample((segment + step / 20) / 8)
      expect(value).toBeGreaterThanOrEqual(Math.min(values[segment], values[segment + 1]) - 1e-6)
      expect(value).toBeLessThanOrEqual(Math.max(values[segment], values[segment + 1]) + 1e-6)
    }
  }
  clip.name = 'jump'
  expect(sample(0.03)).toBeCloseTo(0.096)
})

test('Wei travel matches its recorded stride at a bounded cadence', () => {
  for (const gait of ['walk', 'run'] as const) {
    const dog = controller()
    dog.dog.group.scale.z = 0.85 / 2.6
    dog.dog.gaitCadence = {
      walk: { cyclesPerSecond: 1 / 1.2, travelSpeed: 0.5554858 },
      run: { cyclesPerSecond: 2, travelSpeed: 2.5384731 },
    }
    const target = new THREE.Vector3(0, 0, -100)
    for (let frame = 0; frame < 240; frame++) dog.moveToward(target, gait, 1 / 60, 0)
    const cadence = dog.dog.gaitCadence[gait]
    expect(dog.dog.actionRate * cadence.cyclesPerSecond).toBeLessThanOrEqual(gait === 'walk' ? 1.8 : 3.2)
    expect(dog.dog.actionRate * cadence.travelSpeed * dog.dog.group.scale.z).toBeCloseTo(dog.travelSpeed, 6)
    expect(dog.travelSpeed).toBeGreaterThan(gait === 'walk' ? 0.38 : 1.3)
    if (gait === 'run') {
      for (let frame = 0; frame < 120; frame++) {
        dog.moveToward(target, 'walk', 1 / 60, 0)
        const playing = dog.dog.gaitCadence[dog.dog.action]
        expect(dog.dog.actionRate * playing.cyclesPerSecond).toBeLessThanOrEqual(dog.dog.action === 'walk' ? 1.82 : 3.2)
      }
      expect(dog.dog.action).toBe('walk')
    }
  }
})
