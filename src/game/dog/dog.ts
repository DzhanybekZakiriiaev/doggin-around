import {
  ExtSplats,
  SplatMesh,
  SplatSkinning,
  SplatSkinningMode,
} from "@sparkjsdev/spark"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { type FaceAppearance, loadFaceAppearance } from "./faceAppearance"
import { type FaceHeadLook, loadFaceHeadLook } from "./faceHeadLook"
import { headGazeGain, naturalHeadGaze } from "./headGaze"
import { PawContacts } from "./pawContacts"
import { loadRiggedAppearance } from "./riggedAppearance"
import { sampleSurface, skinMatrix } from "./sampling"

export const DOG_ACTIONS = [
  { name: "idle", label: "Idle", icon: "◌", playback: "loop" },
  { name: "walk", label: "Walk", icon: "↝", playback: "loop" },
  { name: "run", label: "Run", icon: "»", playback: "loop" },
  { name: "sit", label: "Sit", icon: "⌄", playback: "hold" },
  { name: "jump", label: "Jump", icon: "↑", playback: "once" },
  { name: "backflip", label: "Backflip", icon: "↶", playback: "once" },
  { name: "bark", label: "Bark", icon: "◖", playback: "once" },
  { name: "paw", label: "Paw", icon: "✧", playback: "once" },
  { name: "spin", label: "Spin", icon: "⟳", playback: "once" },
  { name: "playbow", label: "Play bow", icon: "⌁", playback: "once" },
  { name: "sniff", label: "Sniff", icon: "⋯", playback: "loop" },
  { name: "dig", label: "Dig", icon: "⌵", playback: "loop" },
  { name: "wag", label: "Wag", icon: "∿", playback: "loop" },
  { name: "stand", label: "Stand", icon: "▵", playback: "hold" },
  { name: "down", label: "Down", icon: "⌄", playback: "hold" },
  { name: "shake", label: "Shake hands", icon: "✧", playback: "once" },
  { name: "highfive", label: "High five", icon: "✋", playback: "once" },
  { name: "touch", label: "Touch", icon: "◎", playback: "once" },
  { name: "speak", label: "Speak", icon: "◖", playback: "once" },
  { name: "quiet", label: "Quiet", icon: "○", playback: "hold" },
  { name: "rollover", label: "Roll over", icon: "⟳", playback: "hold" },
  { name: "crawl", label: "Crawl", icon: "↝", playback: "loop" },
  { name: "backup", label: "Back up", icon: "↤", playback: "loop" },
  { name: "beg", label: "Beg / Pretty", icon: "♧", playback: "hold" },
  { name: "playdead", label: "Play dead", icon: "◇", playback: "hold" },
  { name: "peekaboo", label: "Peekaboo", icon: "⌃", playback: "hold" },
  { name: "weave", label: "Leg weaves", icon: "∞", playback: "loop" },
  { name: "hold", label: "Hold it", icon: "◉", playback: "hold" },
  { name: "gangnam", label: "Gangnam style", icon: "♫", playback: "loop" },
] as const

export type DogAction = (typeof DOG_ACTIONS)[number]["name"]
export type DogView = "splats" | "mesh" | "skeleton"
export type DogAppearance = {
  kind: "smal-pets-faces"
  manifestUrl: string
  density?: number
}
type Skin = {
  source: THREE.SkinnedMesh
  splats: SplatMesh
  skinning: SplatSkinning
}

export class Dog {
  constructor(private readonly renderer?: THREE.WebGLRenderer) {}

  readonly group = new THREE.Group()
  action: DogAction = "idle"
  paused = false
  speed = 1
  density = 50000
  sampleCount = 0
  onPose?: (delta: number) => void
  blendSeconds = 0.3
  private root?: THREE.Group
  private mixer?: THREE.AnimationMixer
  private actions = new Map<DogAction, THREE.AnimationAction>()
  private skins: Skin[] = []
  private helpers: THREE.SkeletonHelper[] = []
  private active?: THREE.AnimationAction
  private transition?: THREE.AnimationAction
  private transitionIsPose = false
  private transitionTime = 0
  private returnToIdle = false
  private currentActionRate = 1
  private loadVersion = 0
  private rebuildVersion = 0
  private view: DogView = "splats"
  private capturedAppearance = false
  private faceAppearance?: FaceAppearance
  private faceTransition?: Float32Array
  private faceBasePositions?: Float32Array
  private faceHeadLook?: FaceHeadLook
  private appearance?: DogAppearance
  private lookTarget: number | undefined
  private lookAngle = 0
  private lookPitchTarget = 0
  private lookPitch = 0
  private lookTime = 0
  private lookBones: Array<{
    bone: THREE.Object3D
    weight: number
    base: THREE.Quaternion
    position: THREE.Vector3
  }> = []
  private lookApplied = false
  private readonly lookRotation = new THREE.Quaternion()
  private readonly lookAxis = new THREE.Vector3(0, 1, 0)
  private readonly lookPitchRotation = new THREE.Quaternion()
  private readonly lookPitchAxis = new THREE.Vector3(1, 0, 0)
  private pawContacts?: PawContacts
  private readonly mouthOffset = new THREE.Vector3(0, -0.04, -0.1)
  private readonly onFinished = (event: {
    action: THREE.AnimationAction
  }): void => {
    if (
      event.action === this.active &&
      DOG_ACTIONS.find(({ name }) => name === this.action)?.playback === "once"
    )
      this.returnToIdle = true
  }

  get availableActions(): DogAction[] {
    return DOG_ACTIONS.map(({ name }) => name).filter((name) =>
      this.actions.has(name),
    )
  }

  get actionRate(): number {
    return this.currentActionRate
  }

  get actionTime(): number {
    return this.active?.time ?? 0
  }

  private actionSequence = 0

  get actionRevision(): number {
    return this.actionSequence
  }

  get actionDuration(): number {
    return this.active?.getClip().duration ?? 1
  }

  sampleBonePosition(
    action: DogAction,
    time: number,
    name: string,
    target: THREE.Vector3,
    offset?: THREE.Vector3,
  ): THREE.Vector3 | undefined {
    const clip = this.actions.get(action)?.getClip()
    if (!this.hasHeadLook || !this.root || !clip) return undefined
    const pose = this.root.clone(true)
    const bone = pose.getObjectByName(name)
    if (!bone) return undefined
    const mixer = new THREE.AnimationMixer(pose)
    const sample = mixer.clipAction(clip)
    sample.setLoop(THREE.LoopOnce, 1)
    sample.clampWhenFinished = true
    sample.play()
    mixer.setTime(time)
    pose.updateMatrixWorld(true)
    bone.localToWorld(offset ? target.copy(offset) : target.set(0, 0, 0))
    mixer.stopAllAction()
    mixer.uncacheRoot(pose)
    return target
  }

  get maxDensity(): number {
    return (
      this.faceAppearance?.maxDensity ??
      (this.capturedAppearance ? 50000 : 100000)
    )
  }

  get gaitCadence():
    | {
        walk: { cyclesPerSecond: number; travelSpeed: number }
        run: { cyclesPerSecond: number; travelSpeed: number }
      }
    | undefined {
    return this.faceAppearance?.gaitCadence
  }

  get hasFaceAppearance(): boolean {
    return this.faceAppearance !== undefined
  }

  getMouthWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true)
    if (this.faceAppearance) {
      return this.faceAppearance.getMouthPosition(target)
    }
    const mouth = this.group.getObjectByName("joint_20")
    if (mouth) return mouth.localToWorld(target.copy(this.mouthOffset))
    return this.group.localToWorld(target.set(0, 1.15, -0.72))
  }

  sampleActionMouthOffset(
    action: DogAction,
    time: number,
    target: THREE.Vector3,
  ): THREE.Vector3 | undefined {
    if (this.faceAppearance?.clips.has(action)) {
      this.group.updateWorldMatrix(true, true)
      const clip = this.actions.get(action)?.getClip()
      if (this.faceHeadLook && clip) {
        const positions = this.faceAppearance.sample(action, time).slice()
        const corrected = this.faceHeadLook.sampleClip(clip, time, positions)
        this.faceAppearance.getMouthPosition(target, corrected)
      } else this.faceAppearance.sampleMouthPosition(action, time, target)
      return this.group.worldToLocal(target)
    }
    const clip = this.actions.get(action)?.getClip()
    if (!this.hasHeadLook || !this.root || !clip) return undefined
    // Sample a separate pose so planning a pickup never moves the live dog.
    const pose = this.root.clone(true)
    const mouth = pose.getObjectByName("joint_20")
    if (!mouth) return undefined
    const mixer = new THREE.AnimationMixer(pose)
    const sample = mixer.clipAction(clip)
    sample.setLoop(THREE.LoopOnce, 1)
    sample.clampWhenFinished = true
    sample.play()
    mixer.setTime(time)
    pose.updateMatrixWorld(true)
    mouth.localToWorld(target.copy(this.mouthOffset))
    mixer.stopAllAction()
    mixer.uncacheRoot(pose)
    return target
  }

  async loadDog(assetUrl: string, appearance?: DogAppearance): Promise<void> {
    const version = ++this.loadVersion
    const candidate = new Dog(this.renderer)
    candidate.density = appearance?.density ?? this.density
    candidate.view = this.view
    try {
      await candidate.prepareDog(assetUrl, appearance)
      if (version !== this.loadVersion) {
        candidate.dispose()
        return
      }
      this.clear()
      this.root = candidate.root
      this.mixer = candidate.mixer
      this.actions = candidate.actions
      this.skins = candidate.skins
      this.helpers = candidate.helpers
      this.active = candidate.active
      this.transition = candidate.transition
      this.transitionIsPose = candidate.transitionIsPose
      this.transitionTime = candidate.transitionTime
      this.faceTransition = candidate.faceTransition
      this.faceBasePositions = candidate.faceBasePositions
      this.faceHeadLook = candidate.faceHeadLook
      this.returnToIdle = candidate.returnToIdle
      this.capturedAppearance = candidate.capturedAppearance
      this.faceAppearance = candidate.faceAppearance
      this.appearance = appearance
      this.lookBones = candidate.lookBones
      this.density = candidate.density
      this.sampleCount = candidate.sampleCount
      this.action = "idle"
      if (this.root) this.group.add(this.root)
      this.group.updateMatrixWorld(true)
      this.pawContacts =
        this.capturedAppearance && !this.faceAppearance
          ? new PawContacts(this.group)
          : undefined
      for (const helper of this.helpers) this.group.add(helper)
      this.mixer?.removeEventListener("finished", candidate.onFinished)
      this.mixer?.addEventListener("finished", this.onFinished)
      this.setView(this.view)
      this.update(0)
    } catch (error) {
      candidate.dispose()
      throw error
    }
  }

  private async prepareDog(
    assetUrl: string,
    appearance?: DogAppearance,
  ): Promise<void> {
    const version = ++this.loadVersion
    const isDefaultAsset =
      new URL(assetUrl, window.location.href).pathname ===
      "/models/dog-animated.glb"
    const gltf = await new GLTFLoader().loadAsync(assetUrl)
    if (version !== this.loadVersion) {
      this.releaseRoot(gltf.scene)
      return
    }
    const sources: THREE.SkinnedMesh[] = []
    gltf.scene.traverse((object) => {
      if (
        object instanceof THREE.SkinnedMesh &&
        !object.name.startsWith("SplatOverlay_")
      )
        sources.push(object)
    })
    if (!sources.length) {
      this.releaseRoot(gltf.scene)
      throw new Error(
        "This GLB has no skinned mesh. Use AniGen's rigged mesh export",
      )
    }
    const capturedAppearance =
      isDefaultAsset &&
      sources.length === 1 &&
      sources[0].skeleton.bones.length === 41 &&
      sources[0].geometry.getAttribute("position").count > 10000
    const clips = new Map(
      gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]),
    )
    if (!clips.has("idle")) {
      this.releaseRoot(gltf.scene)
      throw new Error("Missing idle clip. Run the Blender animation step first")
    }
    this.clear()
    this.capturedAppearance = capturedAppearance
    this.appearance = appearance
    this.root = gltf.scene
    if (appearance) {
      this.faceAppearance = await loadFaceAppearance(
        appearance.manifestUrl,
        this.density,
      )
      if (this.renderer) this.faceAppearance.checkTextureSize(this.renderer)
      for (const { name } of DOG_ACTIONS) {
        const clip = clips.get(name)
        if (!clip) continue
        const baked = this.faceAppearance.clips.get(name)
        if (!baked) throw new Error(`Missing baked motion for ${name}`)
        const tolerance =
          1e-5 +
          1e-6 * Math.max(Math.abs(clip.duration), Math.abs(baked.duration))
        if (
          !Number.isFinite(clip.duration) ||
          Math.abs(clip.duration - baked.duration) > tolerance
        )
          throw new Error(
            `Baked animation duration does not match GLB clip: ${name}`,
          )
      }
    }
    this.density = Math.min(this.density, this.maxDensity)
    this.group.add(this.root)
    const box = new THREE.Box3().setFromObject(this.root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = 2.6 / Math.max(size.x, size.y, size.z)
    this.root.scale.multiplyScalar(scale)
    this.root.position.set(
      -center.x * scale,
      -box.min.y * scale,
      -center.z * scale,
    )
    this.root.updateMatrixWorld(true)
    if (capturedAppearance && !appearance) {
      for (const [name, weight] of [
        ["joint_22", 0.7],
        ["joint_14", 0.3],
        ["joint_21", 0.3],
      ] as const) {
        const bone = this.root.getObjectByName(name)
        if (bone)
          this.lookBones.push({
            bone,
            weight,
            base: bone.quaternion.clone(),
            position: bone.position.clone(),
          })
      }
    }
    this.mixer = new THREE.AnimationMixer(this.root)
    this.mixer.addEventListener("finished", this.onFinished)
    for (const { name, playback } of DOG_ACTIONS) {
      const clip = clips.get(name)
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      if (playback === "loop") {
        action.setLoop(THREE.LoopRepeat, Infinity)
      } else {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      this.actions.set(name, action)
    }
    for (const source of sources) {
      const helper = new THREE.SkeletonHelper(source.skeleton.bones[0])
      const materials = Array.isArray(helper.material)
        ? helper.material
        : [helper.material]
      for (const material of materials) material.depthTest = false
      this.group.add(helper)
      this.helpers.push(helper)
    }
    try {
      if (this.faceAppearance) {
        const source = sources[0]
        for (const object of [
          this.faceAppearance.mesh,
          this.faceAppearance.splats,
        ]) {
          object.matrixAutoUpdate = false
          object.matrix.copy(source.matrix)
          source.parent?.add(object)
        }
        if (this.faceAppearance.manifest.files.headLook) {
          const manifestUrl = new URL(
            this.faceAppearance.manifestUrl,
            window.location.href,
          )
          this.faceHeadLook = await loadFaceHeadLook(
            new URL(this.faceAppearance.manifest.files.headLook, manifestUrl)
              .href,
            source,
            this.faceAppearance.manifest.topologyHash,
          )
        }
        this.sampleCount = this.faceAppearance.splats.numSplats
        this.setView(this.view)
      } else await this.rebuildSplats()
      this.playAction("idle")
    } catch (error) {
      this.clear()
      throw error
    }
  }

  async rebuildSplats(density = this.density): Promise<void> {
    if (!this.root) return
    const version = ++this.rebuildVersion
    if (this.faceAppearance && this.appearance) {
      const current = this.faceAppearance
      const root = this.root
      const modelVersion = this.loadVersion
      const next = await loadFaceAppearance(
        this.appearance.manifestUrl,
        density,
      )
      try {
        if (
          version !== this.rebuildVersion ||
          modelVersion !== this.loadVersion ||
          root !== this.root ||
          current !== this.faceAppearance
        ) {
          next.dispose()
          return
        }
        if (this.renderer) next.checkTextureSize(this.renderer)
        next.updatePositions(current.vertexPositions)
        next.mesh.matrixAutoUpdate = false
        next.mesh.matrix.copy(current.mesh.matrix)
        next.splats.matrixAutoUpdate = false
        next.splats.matrix.copy(current.splats.matrix)
        current.mesh.parent?.add(next.mesh)
        current.splats.parent?.add(next.splats)
        current.dispose()
        this.faceAppearance = next
        this.density = Math.min(density, next.maxDensity)
        this.sampleCount = next.splats.numSplats
        this.setView(this.view)
      } catch (error) {
        next.dispose()
        throw error
      }
      return
    }
    this.density = density
    this.mixer?.stopAllAction()
    this.root.updateMatrixWorld(true)
    const sources: THREE.SkinnedMesh[] = []
    this.root.traverse((object) => {
      if (
        object instanceof THREE.SkinnedMesh &&
        !object.name.startsWith("SplatOverlay_")
      )
        sources.push(object)
    })
    const newSkins: Skin[] = []
    try {
      if (this.capturedAppearance && sources.length === 1) {
        const source = sources[0]
        const { splats, skinning } = await loadRiggedAppearance(source, density)
        newSkins.push({ source, splats, skinning })
      } else {
        const probes = sources.map((source) => sampleSurface(source, 0))
        const totalArea = probes.reduce((sum, probe) => sum + probe.area, 0)
        for (let index = 0; index < sources.length; index++) {
          const source = sources[index]
          const count = Math.max(
            1,
            Math.round((density * probes[index].area) / totalArea),
          )
          const { samples, area } = sampleSurface(source, count, undefined, {
            furFraction: 0.08,
          })
          const packed = new ExtSplats()
          const radius = Math.sqrt(area / samples.length) * 0.85
          for (const sample of samples) {
            const rotation = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 0, 1),
              sample.normal,
            )
            if (sample.fur)
              rotation.multiply(
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 0, 1),
                  (sample.position.x * 93.7 + sample.position.y * 48.3) %
                    Math.PI,
                ),
              )
            const footprint = radius * sample.densityScale
            const scales = sample.fur
              ? new THREE.Vector3(
                  footprint * 1.2,
                  footprint * 0.55,
                  footprint * 0.12,
                )
              : new THREE.Vector3(footprint, footprint, footprint * 0.16)
            packed.pushSplat(
              sample.position,
              scales,
              rotation,
              sample.opacity * (sample.fur ? 0.5 : 1),
              sample.color,
            )
          }
          packed.reinitialize({
            extArrays: packed.extArrays,
            numSplats: packed.numSplats,
          })
          const splats = new SplatMesh({
            extSplats: packed,
            covSplats: true,
            enableLod: false,
          })
          await splats.initialized
          const skinning = new SplatSkinning({
            mesh: splats,
            numBones: source.skeleton.bones.length,
            mode: SplatSkinningMode.LINEAR_BLEND,
          })
          for (let bone = 0; bone < source.skeleton.bones.length; bone++)
            skinning.setRestMatrix(bone, new THREE.Matrix4())
          samples.forEach((sample, i) => {
            const bones = new THREE.Vector4(0, 0, 0, 0),
              weights = new THREE.Vector4(0, 0, 0, 0)
            sample.influences.forEach((influence, j) => {
              bones.setComponent(j, influence.bone)
              weights.setComponent(j, influence.weight)
            })
            skinning.setSplatBones(i, bones, weights)
          })
          splats.skinning = skinning
          splats.updateGenerator()
          splats.matrixAutoUpdate = false
          splats.matrix.copy(source.matrix)
          newSkins.push({ source, splats, skinning })
          await splats.initialized
        }
      }
    } catch (error) {
      for (const skin of newSkins) this.releaseSkin(skin)
      this.playAction("idle")
      throw error
    }
    for (const skin of this.skins) this.releaseSkin(skin)
    this.skins = newSkins
    for (const { source, splats } of this.skins) source.parent?.add(splats)
    this.sampleCount = this.skins.reduce(
      (count, skin) => count + skin.splats.numSplats,
      0,
    )
    this.setView(this.view)
    this.playAction("idle")
    this.update(0)
  }

  playAction(name: DogAction): void {
    const next = this.actions.get(name)
    if (!next || !this.mixer || !this.root) return
    this.actionSequence++
    this.removeLook()
    this.pawContacts?.restore()
    if (name === "quiet") {
      this.mixer.stopAllAction()
      this.releaseTransition()
      this.returnToIdle = false
      this.transitionTime = 0
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play()
      this.active = next
      this.action = name
      this.mixer.update(0)
      return
    }
    if (
      this.active &&
      this.active !== next &&
      !this.active.paused &&
      !this.paused &&
      !this.transition &&
      !this.faceAppearance
    ) {
      // Keep the outgoing stride moving through an uninterrupted blend.
      this.transition = this.active
      this.transitionIsPose = false
      this.transitionTime = 0
      this.returnToIdle = false
      next
        .reset()
        .setEffectiveTimeScale(this.currentActionRate)
        .setEffectiveWeight(0)
        .play()
      this.active = next
      this.action = name
      this.mixer.update(0)
      return
    }
    if (this.faceAppearance && this.active)
      this.faceTransition = (
        this.faceBasePositions ?? this.faceAppearance.vertexPositions
      ).slice()
    // Keep the displayed pose when a blend is interrupted.
    const tracks = new Map<string, THREE.KeyframeTrack>()
    if (this.active)
      for (const action of this.actions.values())
        for (const source of action.getClip().tracks) {
          if (tracks.has(source.name)) continue
          const factory = source as THREE.KeyframeTrack & {
            createInterpolant: {
              isInterpolantFactoryMethodGLTFCubicSpline?: boolean
            }
          }
          // Cubic glTF keys contain two tangents and one value.
          const width =
            source.getValueSize() /
            (factory.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline
              ? 3
              : 1)
          const track = source.clone()
          track.times = new Float32Array([0])
          track.values = new Float32Array(width)
          track.setInterpolation(track.DefaultInterpolation)
          const binding = new THREE.PropertyBinding(
            this.root,
            track.name,
          ) as THREE.PropertyBinding & {
            getValue: (values: Float32Array, offset: number) => void
          }
          binding.getValue(track.values, 0)
          tracks.set(track.name, track)
        }
    this.transitionTime = 0
    this.returnToIdle = false
    this.mixer.stopAllAction()
    this.releaseTransition()
    if (tracks.size) {
      const pose = new THREE.AnimationClip("transition", 0.3, [
        ...tracks.values(),
      ])
      this.transition = this.mixer.clipAction(pose).play()
      this.transition.paused = true
      this.transitionIsPose = true
    }
    next
      .reset()
      .setEffectiveTimeScale(this.currentActionRate)
      .setEffectiveWeight(this.transition ? 0 : 1)
      .play()
    this.active = next
    this.action = name
    this.mixer.update(0)
  }

  setActionRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0)
      throw new RangeError("Action rate must be positive and finite")
    this.currentActionRate = rate
    this.active?.setEffectiveTimeScale(rate)
  }

  lookToward(headingOffset: number, pitch = 0): void {
    this.lookTarget = Number.isFinite(headingOffset)
      ? THREE.MathUtils.clamp(headingOffset, -0.5, 0.5)
      : 0
    this.lookPitchTarget = Number.isFinite(pitch)
      ? THREE.MathUtils.clamp(pitch, -0.16, 0.16)
      : 0
  }

  lookAround(): void {
    this.lookTarget = undefined
  }

  get hasHeadLook(): boolean {
    return this.lookBones.length > 0 || this.faceHeadLook !== undefined
  }

  private removeLook(): void {
    this.faceHeadLook?.restore()
    if (!this.lookApplied) return
    for (const { bone, base, position } of this.lookBones) {
      bone.quaternion.copy(base)
      bone.position.copy(position)
    }
    this.lookApplied = false
  }

  setView(view: DogView): void {
    this.view = view
    this.root?.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object instanceof SplatMesh))
        object.visible =
          view === "mesh" ||
          (view === "splats" && object.name.startsWith("SplatOverlay_"))
    })
    for (const skin of this.skins) skin.splats.visible = view === "splats"
    if (this.faceAppearance) {
      this.root?.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.visible = false
      })
      this.faceAppearance.mesh.visible = view === "mesh"
      this.faceAppearance.splats.visible = view === "splats"
    }
    for (const helper of this.helpers) helper.visible = view === "skeleton"
  }

  /** How long `action`'s clip runs at rate 1, in seconds (0 if the model has no such clip). */
  clipDuration(action: DogAction): number {
    return this.actions.get(action)?.getClip().duration ?? 0
  }

  /** The mesh made see-through, so the rig shows inside it (the menu's pipeline); off puts it back as it was. */
  setXray(on: boolean): void {
    this.root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof SplatMesh) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        const solid = (material.userData.solid ??= {
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        })
        material.transparent = on || solid.transparent
        material.opacity = on ? 0.3 : solid.opacity
        material.depthWrite = on ? false : solid.depthWrite
        material.needsUpdate = true
      }
    })
  }

  /** The rig drawn over whichever view is showing (the menu's pipeline lights it up inside him). */
  showRig(on: boolean): void {
    for (const helper of this.helpers) {
      helper.visible = on || this.view === "skeleton"
      // After the splats (they blend over anything drawn before them), in the comic's yellow and red.
      helper.renderOrder = 1000
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material]
      for (const material of materials) material.transparent = true
      helper.setColors(new THREE.Color(0xffd322), new THREE.Color(0xf04431))
      // A SkeletonHelper's matrix is its root bone's world matrix, meant for a helper at the scene's root;
      // under this (scaled, placed) group it would be applied twice, so pin it to the bones as it's drawn.
      helper.onBeforeRender = () => void helper.matrixWorld.copy(helper.root.matrixWorld)
    }
  }

  update(delta: number): void {
    const step = this.paused ? 0 : Math.min(delta, 0.1) * this.speed
    this.removeLook()
    this.pawContacts?.restore()
    if (this.transition) {
      this.transitionTime += step
      const progress = Math.min(this.transitionTime / this.blendSeconds, 1)
      const weight = progress * progress * (3 - 2 * progress)
      this.active?.setEffectiveWeight(weight)
      this.transition.setEffectiveWeight(1 - weight)
    }
    this.mixer?.update(step)
    let faceSample: Float32Array | undefined
    if (this.faceAppearance && this.active) {
      const sample = this.faceAppearance.sample(this.action, this.active.time)
      if (this.faceTransition) {
        const progress = Math.min(this.transitionTime / this.blendSeconds, 1)
        const weight = progress * progress * (3 - 2 * progress)
        for (let index = 0; index < sample.length; index++)
          sample[index] =
            this.faceTransition[index] * (1 - weight) + sample[index] * weight
        if (progress === 1) this.faceTransition = undefined
      }
      this.faceBasePositions ??= new Float32Array(sample.length)
      this.faceBasePositions.set(sample)
      faceSample = sample
    }
    if (this.returnToIdle) this.playAction("idle")
    else if (this.transitionTime >= this.blendSeconds) this.releaseTransition()
    this.lookTime += step
    const gaze = naturalHeadGaze(this.lookTime)
    const gain = headGazeGain(this.action)
    this.lookAngle += THREE.MathUtils.clamp(
      THREE.MathUtils.damp(
        this.lookAngle,
        (this.lookTarget ?? gaze.yaw) * gain,
        8,
        step,
      ) - this.lookAngle,
      -step * 1.1,
      step * 1.1,
    )
    this.lookPitch += THREE.MathUtils.clamp(
      THREE.MathUtils.damp(
        this.lookPitch,
        (this.lookTarget === undefined ? gaze.pitch : this.lookPitchTarget) *
          gain,
        8,
        step,
      ) - this.lookPitch,
      -step * 0.45,
      step * 0.45,
    )
    const head = this.lookBones.find(({ bone }) => bone.name === "joint_14")
    for (const { bone, weight, base, position } of this.lookBones) {
      base.copy(bone.quaternion)
      position.copy(bone.position)
      if (head && bone.name === "joint_21") {
        // The sibling jaw must turn around the head's pivot.
        this.lookRotation
          .copy(head.base)
          .invert()
          .premultiply(head.bone.quaternion)
        bone.quaternion.premultiply(this.lookRotation)
        bone.position
          .sub(head.bone.position)
          .applyQuaternion(this.lookRotation)
          .add(head.bone.position)
      } else {
        this.lookRotation.setFromAxisAngle(
          this.lookAxis,
          this.lookAngle * weight,
        )
        this.lookPitchRotation.setFromAxisAngle(
          this.lookPitchAxis,
          this.lookPitch * weight,
        )
        this.lookRotation.multiply(this.lookPitchRotation)
        bone.quaternion.multiply(this.lookRotation)
      }
    }
    this.lookApplied = true
    if (this.faceAppearance && faceSample) {
      this.faceHeadLook?.apply(faceSample, this.lookAngle, this.lookPitch)
      this.faceAppearance.updatePositions(faceSample)
    }
    this.onPose?.(step)
    this.group.updateMatrixWorld(true)
    this.pawContacts?.update(
      step,
      this.action === "walk" || this.action === "run",
    )
    for (const { source, skinning, splats } of this.skins) {
      splats.matrix.copy(source.matrix)
      for (let i = 0; i < source.skeleton.bones.length; i++)
        skinning.setBoneMatrix(i, skinMatrix(source, i))
      skinning.updateBones()
    }
  }

  private releaseTransition(): void {
    if (!this.transition) return
    this.transition.stop()
    if (this.transitionIsPose)
      this.mixer?.uncacheAction(this.transition.getClip())
    this.transition = undefined
    this.transitionIsPose = false
  }

  private releaseSkin({ splats, skinning }: Skin): void {
    splats.removeFromParent()
    skinning.skinTexture.dispose()
    skinning.boneTexture.dispose()
    splats.dispose()
  }

  private releaseRoot(root: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      for (const material of materials) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value)
        material.dispose()
      }
    })
    for (const texture of textures) {
      texture.dispose()
      if (
        typeof ImageBitmap !== "undefined" &&
        texture.image instanceof ImageBitmap
      )
        texture.image.close()
    }
  }

  private clear(): void {
    this.removeLook()
    this.pawContacts?.restore()
    this.pawContacts = undefined
    this.lookBones = []
    this.lookAngle = 0
    this.lookTarget = undefined
    this.lookPitchTarget = 0
    this.lookPitch = 0
    this.lookTime = 0
    this.faceAppearance?.dispose()
    this.faceAppearance = undefined
    this.faceTransition = undefined
    this.faceBasePositions = undefined
    this.faceHeadLook = undefined
    this.appearance = undefined
    for (const skin of this.skins) this.releaseSkin(skin)
    this.skins = []
    for (const helper of this.helpers) {
      helper.removeFromParent()
      helper.dispose()
    }
    this.helpers = []
    if (this.root) {
      this.mixer?.stopAllAction()
      this.mixer?.uncacheRoot(this.root)
      this.releaseRoot(this.root)
      this.root.removeFromParent()
    }
    this.root = undefined
    this.mixer = undefined
    this.actions.clear()
    this.active = undefined
    this.transition = undefined
    this.transitionTime = 0
    this.returnToIdle = false
    this.currentActionRate = 1
    this.capturedAppearance = false
    this.sampleCount = 0
  }

  dispose(): void {
    ++this.loadVersion
    this.clear()
    this.group.removeFromParent()
  }
}
