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
