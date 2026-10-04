import * as THREE from "three"
import type { Dog } from "./dog"

export type FetchState =
  | "idle"
  | "throwing"
  | "chasing"
  | "returning"
  | "settling"

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
  private readonly throwStart = new THREE.Vector3()
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly raycaster = new THREE.Raycaster()
  private throwProgress = 0
  private locomotion: "walk" | "run" = "walk"
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
    this.pickupPoint
      .copy(this.target)
      .lerp(this.home, distance > 0 ? Math.min(0.72 / distance, 1) : 1)
    this.throwStart
      .copy(this.dog.group.position)
      .add(new THREE.Vector3(0, 0.9, 0))
    this.ball.position.copy(this.throwStart)
    this.ball.visible = true
    this.throwProgress = 0
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
        this.dog.playAction(this.locomotion)
      }
      return
    }
    if (this.state === "chasing") {
      if (this.moveToward(this.pickupPoint, step)) {
        this.state = "returning"
        this.dog.playAction(this.locomotion)
      }
    } else if (this.state === "returning") {
      if (this.moveToward(this.home, step)) {
        this.state = "settling"
        this.dog.playAction("idle")
        this.dropBall()
      }
    } else if (this.state === "settling") {
      this.turnToward(this.homeYaw, step)
      if (Math.abs(this.angleDifference(this.homeYaw)) < 0.025)
        this.state = "idle"
    }
    if (this.state === "returning") this.carryBall()
  }

  stop(): void {
    if (this.disposed) return
    this.state = "idle"
    this.ball.visible = false
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
    if (distance <= 0.08) {
      this.dog.group.position.copy(point)
      return true
    }
    this.turnToward(Math.atan2(-direction.x, -direction.z), delta)
    const travel = Math.min(
      distance,
      (this.locomotion === "run" ? 2.1 : 1.35) * delta,
    )
    this.dog.group.position.addScaledVector(direction, travel / distance)
    if (distance <= travel + 0.08) {
      this.dog.group.position.copy(point)
      return true
    }
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
    this.dog.group.rotation.y +=
      Math.sign(difference) * Math.min(Math.abs(difference), 5 * delta)
  }

  private carryBall(): void {
    this.dog.group.updateWorldMatrix(true, false)
    this.ball.position.copy(
      this.dog.group.localToWorld(new THREE.Vector3(0, 1.15, -0.72)),
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
