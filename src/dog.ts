import {
  ExtSplats,
  SplatMesh,
  SplatSkinning,
  SplatSkinningMode,
} from "@sparkjsdev/spark"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { loadRiggedAppearance } from "./riggedAppearance"
import { sampleSurface, skinMatrix } from "./sampling"

export const DOG_ACTIONS = [
  { name: "idle", label: "Idle", icon: "◌", playback: "loop" },
  { name: "walk", label: "Walk", icon: "↝", playback: "loop" },
  { name: "run", label: "Run", icon: "»", playback: "loop" },
  { name: "sit", label: "Sit", icon: "⌄", playback: "hold" },
  { name: "jump", label: "Jump", icon: "↑", playback: "once" },
  { name: "bark", label: "Bark", icon: "◖", playback: "once" },
  { name: "paw", label: "Paw", icon: "✧", playback: "once" },
  { name: "spin", label: "Spin", icon: "⟳", playback: "once" },
  { name: "playbow", label: "Play bow", icon: "⌁", playback: "once" },
  { name: "sniff", label: "Sniff", icon: "⋯", playback: "loop" },
  { name: "wag", label: "Wag", icon: "∿", playback: "loop" },
] as const

export type DogAction = (typeof DOG_ACTIONS)[number]["name"]
export type DogView = "splats" | "mesh" | "skeleton"
type Skin = {
  source: THREE.SkinnedMesh
  splats: SplatMesh
  skinning: SplatSkinning
}

export class Dog {
  readonly group = new THREE.Group()
  action: DogAction = "idle"
  paused = false
  speed = 1
  density = 50000
  sampleCount = 0
  private root?: THREE.Group
  private mixer?: THREE.AnimationMixer
  private actions = new Map<DogAction, THREE.AnimationAction>()
  private skins: Skin[] = []
  private helpers: THREE.SkeletonHelper[] = []
  private active?: THREE.AnimationAction
  private transition?: THREE.AnimationAction
  private transitionTime = 0
  private returnToIdle = false
  private currentActionRate = 1
  private loadVersion = 0
  private view: DogView = "splats"
  private capturedAppearance = false

  get availableActions(): DogAction[] {
    return DOG_ACTIONS.map(({ name }) => name).filter((name) =>
      this.actions.has(name),
    )
  }

  get actionRate(): number {
    return this.currentActionRate
  }

  get maxDensity(): number {
    return this.capturedAppearance ? 50000 : 100000
  }

  async loadDog(assetUrl: string): Promise<void> {
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
    this.density = Math.min(this.density, this.maxDensity)
    this.root = gltf.scene
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
    this.mixer = new THREE.AnimationMixer(this.root)
    this.mixer.addEventListener("finished", (event) => {
      if (event.action === this.active && this.action !== "sit")
        this.returnToIdle = true
    })
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
      await this.rebuildSplats()
      this.playAction("idle")
    } catch (error) {
      this.clear()
      throw error
    }
  }

  async rebuildSplats(density = this.density): Promise<void> {
    if (!this.root) return
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

  setView(view: DogView): void {
    this.view = view
    this.root?.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object instanceof SplatMesh))
        object.visible =
          view === "mesh" ||
          (view === "splats" && object.name.startsWith("SplatOverlay_"))
    })
    for (const skin of this.skins) skin.splats.visible = view === "splats"
    for (const helper of this.helpers) helper.visible = view === "skeleton"
  }

  update(delta: number): void {
    const step = this.paused ? 0 : Math.min(delta, 0.1) * this.speed
    if (this.transition) {
      this.transitionTime += step
      const progress = Math.min(this.transitionTime / 0.3, 1)
      const weight = progress * progress * (3 - 2 * progress)
      this.active?.setEffectiveWeight(weight)
      this.transition.setEffectiveWeight(1 - weight)
    }
    this.mixer?.update(step)
    if (this.returnToIdle) this.playAction("idle")
    else if (this.transitionTime >= 0.3) this.releaseTransition()
    this.group.updateMatrixWorld(true)
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
    this.mixer?.uncacheAction(this.transition.getClip())
    this.transition = undefined
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
