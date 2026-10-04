import * as THREE from "three"
import type { Dog } from "./dog"

export type FetchState =
  | "idle"
  | "throwing"
  | "chasing"
  | "picking-up"
  | "returning"
  | "settling"

const TRAVEL_SPEED = { walk: 1.35, run: 2.1 } as const
const CONTACT_GAIT_SPEED = { walk: 2.25, run: 4.7 } as const
const HUAWEI_PICKUP_REACH = 0.42
const PICKUP_DURATION = 1.2
const GRAB_START = 0.85
const ACCELERATION = 4
const BRAKING = 6
const TURN_ACCELERATION = 12
const MAX_TURN_SPEED = 3.8

export class FetchInteraction {
  readonly ball = new THREE.Group()
  state: FetchState = "idle"

  private readonly home: THREE.Vector3
  private readonly homeYaw: number
  private readonly ballGeometry = new THREE.SphereGeometry(0.12, 20, 16)
  private readonly ballMaterial = new THREE.MeshStandardMaterial({
    color: 0xe58839,
    roughness: 0.7,
  })
  private readonly stripeGeometry = new THREE.TorusGeometry(0.121, 0.012, 6, 32)
  private readonly stripeMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9f2d9,
    roughness: 0.75,
  })
  private readonly target = new THREE.Vector3()
  private readonly pickupPoint = new THREE.Vector3()
  private readonly pickupOffset = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly throwStart = new THREE.Vector3()
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly raycaster = new THREE.Raycaster()
  private readonly mouthOffset = new THREE.Vector3(0, -0.04, -0.1)
  private readonly mouthPosition = new THREE.Vector3()
  private readonly groundBallPosition = new THREE.Vector3()
  private throwProgress = 0
  private pickupElapsed = 0
  private pickupHeading?: number
  private locomotion: "walk" | "run" = "walk"
  private velocity = 0
  private turnVelocity = 0
  private pointerDown?: { id: number; x: number; y: number }
  private disposed = false

  constructor(
    private readonly dog: Dog,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly viewport: HTMLElement,
  ) {
    this.home = dog.group.position.clone()
    this.homeYaw = dog.group.rotation.y
    this.ball.add(new THREE.Mesh(this.ballGeometry, this.ballMaterial))
    const stripe = new THREE.Mesh(this.stripeGeometry, this.stripeMaterial)
    stripe.rotation.x = Math.PI / 2
    this.ball.add(stripe)
    this.ball.visible = false
    scene.add(this.ball)
    viewport.addEventListener("pointerdown", this.onPointerDown)
    viewport.addEventListener("pointerup", this.onPointerUp)
    viewport.addEventListener("pointercancel", this.onPointerCancel)
  }

  throwTo(point: THREE.Vector3): boolean {
    if (
      this.disposed ||
      this.dog.sampleCount === 0 ||
      !this.dog.availableActions.includes("walk")
    )
      return false
    this.stop()
    this.dog.paused = false
    this.target.set(point.x, 0, point.z)
    const offset = this.target.clone().sub(this.home)
    if (offset.length() > 2.6)
      this.target.copy(this.home).add(offset.setLength(2.6))
    const distance = this.target.distanceTo(this.home)
    this.locomotion =
      distance > 1.6 && this.dog.availableActions.includes("run")
        ? "run"
        : "walk"
    const mouth = this.dog.group.getObjectByName("joint_20")
    const reach =
      !this.dog.hasFaceAppearance && mouth?.parent?.name === "joint_21"
        ? HUAWEI_PICKUP_REACH
        : 0.72
    this.pickupPoint
      .copy(this.target)
      .lerp(this.home, distance > 0 ? Math.min(reach / distance, 1) : 1)
    if (
      (this.dog.hasFaceAppearance || this.dog.hasHeadLook) &&
      this.dog.availableActions.includes("sniff") &&
      this.dog.sampleActionMouthOffset("sniff", GRAB_START, this.pickupOffset)
    ) {
      this.pickupHeading =
        distance > 1e-8
          ? Math.atan2(-offset.x, -offset.z)
          : this.dog.group.rotation.y
      this.pickupOffset.y = 0
      this.pickupOffset.applyAxisAngle(this.up, this.pickupHeading)
      this.pickupPoint.copy(this.target).sub(this.pickupOffset)
      this.pickupPoint.y = this.home.y
    }
    this.throwStart
      .copy(this.dog.group.position)
      .add(new THREE.Vector3(0, 0.9, 0))
    this.ball.position.copy(this.throwStart)
    this.ball.visible = true
    this.throwProgress = 0
    this.pickupElapsed = 0
    this.state = "throwing"
    return true
  }

  update(delta: number): void {
    if (this.disposed || this.dog.paused || this.state === "idle") return
    const step = Math.min(Math.max(delta, 0), 0.1) * this.dog.speed
    if (this.state === "throwing") {
      this.throwProgress = Math.min(1, this.throwProgress + step / 0.55)
      const progress = this.throwProgress
      this.ball.position.lerpVectors(this.throwStart, this.target, progress)
      this.ball.position.y +=
        0.72 * Math.sin(Math.PI * progress) + 0.12 * progress
      if (progress === 1) {
        this.state = "chasing"
        this.dog.setActionRate(0.18)
        this.dog.playAction("walk")
      }
      return
    }
    if (this.state === "chasing") {
      if (this.moveToward(this.pickupPoint, step)) {
        if (this.pickupHeading !== undefined) {
          this.turnToward(this.pickupHeading, step)
          this.updateGaitRate("walk")
          if (
            Math.abs(this.angleDifference(this.pickupHeading)) >= 0.006 ||
            Math.abs(this.turnVelocity) >= 0.03
          )
            return
          this.turnVelocity = 0
        }
        if (this.dog.availableActions.includes("sniff")) {
          this.state = "picking-up"
          this.pickupElapsed = 0
          this.groundBallPosition.copy(this.ball.position)
          this.dog.lookToward(0)
          this.dog.setActionRate(1)
          this.dog.playAction("sniff")
        } else {
          this.state = "returning"
        }
      }
    } else if (this.state === "picking-up") {
      this.pickupElapsed = Math.min(PICKUP_DURATION, this.pickupElapsed + step)
      this.updateBallPosition()
      if (this.pickupElapsed === PICKUP_DURATION) {
        this.state = "returning"
        this.dog.setActionRate(0.18)
        this.dog.playAction("walk")
      }
      return
    } else if (this.state === "returning") {
      if (this.moveToward(this.home, step)) {
        this.state = "settling"
        this.dog.playAction("walk")
      }
    } else if (this.state === "settling") {
      this.turnToward(this.homeYaw, step)
      this.updateGaitRate("walk")
      if (
        Math.abs(this.angleDifference(this.homeYaw)) < 0.006 &&
        Math.abs(this.turnVelocity) < 0.03
      ) {
        this.state = "idle"
        this.turnVelocity = 0
        this.dog.lookToward(0)
        this.dog.setActionRate(1)
        this.dog.playAction("idle")
        this.dropBall()
      }
    }
    this.updateBallPosition()
  }

  updateBallPosition(): void {
    if (this.disposed || this.dog.paused) return
    if (this.state === "returning" || this.state === "settling")
      this.carryBall()
    else if (this.state === "picking-up") {
      const grab = Math.max(
        0,
        Math.min(
          1,
          (this.pickupElapsed - GRAB_START) / (PICKUP_DURATION - GRAB_START),
        ),
      )
      if (grab > 0)
        this.ball.position.lerpVectors(
          this.groundBallPosition,
          this.getMouthPosition(),
          grab * grab * (3 - 2 * grab),
        )
    }
  }

  stop(): void {
    if (this.disposed) return
    this.state = "idle"
    this.ball.visible = false
    this.pickupElapsed = 0
    this.pickupHeading = undefined
    this.velocity = 0
    this.turnVelocity = 0
    this.dog.lookToward(0)
    this.dog.setActionRate(1)
    this.dog.playAction("idle")
  }

  reset(): void {
    if (this.disposed) return
    this.stop()
    this.dog.group.position.copy(this.home)
    this.dog.group.rotation.y = this.homeYaw
  }

  dispose(): void {
    if (this.disposed) return
    this.viewport.removeEventListener("pointerdown", this.onPointerDown)
    this.viewport.removeEventListener("pointerup", this.onPointerUp)
    this.viewport.removeEventListener("pointercancel", this.onPointerCancel)
    this.ball.removeFromParent()
    this.ballGeometry.dispose()
    this.ballMaterial.dispose()
    this.stripeGeometry.dispose()
    this.stripeMaterial.dispose()
    this.disposed = true
  }

  private moveToward(point: THREE.Vector3, delta: number): boolean {
    const direction = point.clone().sub(this.dog.group.position)
    direction.y = 0
    const distance = direction.length()
    if (distance <= 0.001) {
      this.dog.group.position.copy(point)
      this.velocity = 0
      return true
    }
    const heading = Math.atan2(-direction.x, -direction.z)
    this.turnToward(heading, delta)
    const facing = Math.max(0, Math.cos(this.angleDifference(heading)))
    const desiredSpeed = Math.min(
      this.travelSpeed * facing * facing,
      Math.sqrt((BRAKING * delta) ** 2 + 2 * BRAKING * distance) -
        BRAKING * delta,
      distance * 4,
    )
    const change =
      (desiredSpeed > this.velocity ? ACCELERATION : BRAKING) * delta
    this.velocity += THREE.MathUtils.clamp(
      desiredSpeed - this.velocity,
      -change,
      change,
    )
    const travel = Math.min(distance, this.velocity * delta)
    this.dog.group.position.addScaledVector(direction, travel / distance)
    this.updateGaitRate(this.locomotion)
    return false
  }

  private angleDifference(target: number): number {
    return Math.atan2(
      Math.sin(target - this.dog.group.rotation.y),
      Math.cos(target - this.dog.group.rotation.y),
    )
  }

  private turnToward(target: number, delta: number): void {
    const difference = this.angleDifference(target)
    this.dog.lookToward(difference)
    const desiredSpeed =
      Math.sign(difference) *
      Math.min(
        MAX_TURN_SPEED,
        Math.abs(difference) * 7,
        Math.sqrt(2 * TURN_ACCELERATION * Math.abs(difference)),
      )
    this.turnVelocity += THREE.MathUtils.clamp(
      desiredSpeed - this.turnVelocity,
      -TURN_ACCELERATION * delta,
      TURN_ACCELERATION * delta,
    )
    this.dog.group.rotation.y += this.turnVelocity * delta
  }

  private updateGaitRate(action: "walk" | "run"): void {
    const gait =
      action === "run" &&
      this.velocity > (this.dog.action === "run" ? 0.95 : 1.4) &&
      Math.abs(this.turnVelocity) < 2.2
        ? "run"
        : "walk"
    if (this.dog.action !== gait) this.dog.playAction(gait)
    const strideSpeed =
      this.dog.gaitCadence?.[gait].travelSpeed ?? CONTACT_GAIT_SPEED[gait]
    // Turning still needs steps when forward travel has stopped.
    const pawSpeed = Math.hypot(this.velocity, this.turnVelocity * 0.35)
    this.dog.setActionRate(Math.max(0.14, pawSpeed / strideSpeed))
  }

  private carryBall(): void {
    this.ball.position.copy(this.getMouthPosition())
  }

  private getMouthPosition(): THREE.Vector3 {
    if (this.dog.hasFaceAppearance || this.dog.hasHeadLook)
      return this.dog.getMouthWorldPosition(this.mouthPosition)
    const tip = this.dog.group.getObjectByName("joint_20")
    if (tip?.parent?.name === "joint_21")
      return tip.localToWorld(this.mouthPosition.copy(this.mouthOffset))
    return this.dog.group.localToWorld(this.mouthPosition.set(0, 1.15, -0.72))
  }

  private get travelSpeed(): number {
    return (
      this.dog.gaitCadence?.[this.locomotion].travelSpeed ??
      TRAVEL_SPEED[this.locomotion]
    )
  }

  private dropBall(): void {
    this.dog.group.updateWorldMatrix(true, false)
    this.ball.position.copy(
      this.dog.group.localToWorld(new THREE.Vector3(0, 0.12, -0.86)),
    )
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return
    this.pointerDown = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown
    this.pointerDown = undefined
    if (!start || start.id !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return
    const bounds = this.viewport.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.camera.updateWorldMatrix(true, false)
    this.raycaster.setFromCamera(pointer, this.camera)
    const hit = this.raycaster.ray.intersectPlane(
      this.floor,
      new THREE.Vector3(),
    )
    if (hit && hit.distanceTo(this.home) <= 4.5) this.throwTo(hit)
  }

  private readonly onPointerCancel = (): void => {
    this.pointerDown = undefined
  }
}
